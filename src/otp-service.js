import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { parseDatabaseTimestamp as parseTime } from './database-time.js';

const clean = (value) => String(value ?? "").trim();
const timestamp = (value = Date.now()) => new Date(value).toISOString();
const dbTimestamp = (value) =>
  new Date(value).toISOString().replace("T", " ").replace("Z", "");
const maskPhone = (phone) => `+91 ••••••${String(phone).slice(-4)}`;
const parseBoolean = (value) => {
  if (typeof value === "string") {
    const parsed = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(parsed)) return false;
    if (["true", "1", "on", "yes"].includes(parsed)) return true;
  }
  return Boolean(value);
};

export class OtpService {
  constructor(db, { providers = {}, providerResolver, secret } = {}) {
    this.db = db;
    this.secret =
      secret || process.env.OTP_SECRET || randomBytes(32).toString("hex");
    // Providers must be injected by the server runtime. Keeping a built-in
    // delivery provider made it possible for a merchant to enable OTP without
    // configuring SMS delivery and exposed development codes to customers.
    this.providers = { ...providers };
    this.providerResolver = providerResolver;
  }

  provider(storeId, name) {
    return this.providerResolver?.(storeId, name) || this.providers[name] || null;
  }

  hasProvider(storeId, name) {
    return Boolean(this.provider(storeId, name)?.send);
  }

  #checkout(storeId, sessionId) {
    const checkout = this.db
      .prepare(
        "SELECT * FROM checkout_sessions WHERE store_id=? AND id=? AND status='draft'",
      )
      .get(storeId, clean(sessionId));
    if (!checkout) throw new Error("Active checkout session not found");
    const updatedAt = parseTime(checkout.updated_at);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 2 * 60 * 60_000)
      throw new Error("Checkout session has expired. Please start again.");
    return checkout;
  }

  #hash(otp, salt = randomBytes(16).toString("hex")) {
    return `${salt}:${createHmac("sha256", this.secret).update(`${salt}:${otp}`).digest("hex")}`;
  }

  #matches(otp, stored) {
    const [salt, expected] = clean(stored).split(":"),
      actual = this.#hash(otp, salt).split(":")[1];
    return Boolean(
      expected &&
        actual.length === expected.length &&
        timingSafeEqual(Buffer.from(actual), Buffer.from(expected)),
    );
  }

  #latest(storeId, sessionId, phone) {
    return this.db
      .prepare(
        "SELECT * FROM otp_verifications WHERE store_id=? AND checkout_session_id=? AND phone=? ORDER BY created_at DESC,id DESC LIMIT 1",
      )
      .get(storeId, clean(sessionId), clean(phone));
  }

  async send(storeId, input, settings) {
    if (!parseBoolean(settings?.enabled)) throw new Error("OTP verification is disabled");
    const checkout = this.#checkout(storeId, input.checkoutSessionId),
      phone = clean(input.phone);
    if (!/^[6-9][0-9]{9}$/.test(phone))
      throw new Error("Enter a valid 10-digit Indian mobile number");
    if (checkout.phone !== phone)
      throw new Error("Phone number does not match this checkout");
    const provider = this.provider(storeId, settings.provider);
    if (!provider?.send)
      throw new Error("OTP provider is not configured on the server");
    const recentRequests = Number(
      this.db
        .prepare(
          "SELECT COUNT(*) count FROM otp_verifications WHERE store_id=? AND phone=? AND created_at>=?",
        )
        .get(storeId, phone, dbTimestamp(Date.now() - 15 * 60_000)).count,
    );
    if (recentRequests >= 3)
      throw new Error("Too many OTP requests. Please try again later.");
    const current = this.#latest(storeId, checkout.id, phone),
      resendCount = current ? Number(current.resend_count) + 1 : 0;
    if (current) {
      const nextAllowed =
        parseTime(current.last_sent_at) + settings.resendDelaySeconds * 1000;
      if (Date.now() < nextAllowed)
        throw new Error(
          `Resend OTP in ${Math.ceil((nextAllowed - Date.now()) / 1000)} seconds`,
        );
      if (resendCount > settings.maxResends)
        throw new Error("Maximum OTP resend attempts reached");
    }
    const otp = String(
        randomInt(
          10 ** (Number(settings.length) - 1),
          10 ** Number(settings.length),
        ),
      ),
      now = Date.now(),
      expiresAt = timestamp(now + settings.expiryMinutes * 60_000),
      result = await provider.send({
        storeId,
        checkoutSessionId: checkout.id,
        phone,
        otp,
        expiresInMinutes: settings.expiryMinutes,
      });
    if (!result?.delivered) throw new Error(result?.error || "OTP delivery failed");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO otp_verifications (id,store_id,checkout_session_id,phone,otp_hash,status,attempt_count,resend_count,last_sent_at,expires_at) VALUES (?,?,?,?,?,'OTP_SENT',0,?,?,?)",
      )
      .run(
        id,
        storeId,
        checkout.id,
        phone,
        this.#hash(otp),
        resendCount,
        timestamp(now),
        expiresAt,
      );
    this.db
      .prepare(
        "UPDATE checkout_sessions SET phone_verification_status='OTP_SENT',phone_verified_at=NULL,otp_required=1,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(storeId, checkout.id);
    return {
      status: "OTP_SENT",
      maskedPhone: maskPhone(phone),
      expiresAt,
      resendAvailableAt: timestamp(now + settings.resendDelaySeconds * 1000),
      attemptsRemaining: settings.maxAttempts,
    };
  }

  async verify(storeId, input, settings) {
    if (!parseBoolean(settings?.enabled)) throw new Error("OTP verification is disabled");
    const checkout = this.#checkout(storeId, input.checkoutSessionId),
      phone = clean(input.phone),
      otp = clean(input.otp),
      current = this.#latest(storeId, checkout.id, phone);
    if (checkout.phone !== phone)
      throw new Error("Phone number changed. Send a new OTP.");
    if (!current) throw new Error("Send OTP before verification");
    if (current.status === "VERIFIED")
      return {
        status: "VERIFIED",
        maskedPhone: maskPhone(phone),
        verifiedAt: current.verified_at,
      };
    if (Date.now() >= parseTime(current.expires_at)) {
      this.db
        .prepare("UPDATE otp_verifications SET status='EXPIRED' WHERE id=?")
        .run(current.id);
      this.db
        .prepare(
          "UPDATE checkout_sessions SET phone_verification_status='EXPIRED',phone_verified_at=NULL WHERE store_id=? AND id=?",
        )
        .run(storeId, checkout.id);
      throw new Error("This OTP has expired. Send a new OTP.");
    }
    const attempts = Number(current.attempt_count);
    if (attempts >= settings.maxAttempts || current.status === "FAILED")
      throw new Error("Verification temporarily blocked. Request a new OTP later.");
    if (!new RegExp(`^\\d{${Number(settings.length)}}$`).test(otp))
      throw new Error(`Enter the ${Number(settings.length)}-digit OTP`);
    const provider = this.provider(storeId, settings.provider),
      providerResult = provider?.verify
        ? await provider.verify({
            storeId,
            checkoutSessionId: checkout.id,
            phone,
            otp,
          })
        : null,
      matches = providerResult
        ? providerResult.verified === true
        : this.#matches(otp, current.otp_hash);
    if (!matches) {
      const nextAttempts = attempts + 1,
        failed = nextAttempts >= settings.maxAttempts;
      this.db
        .prepare(
          "UPDATE otp_verifications SET attempt_count=?,status=? WHERE id=?",
        )
        .run(nextAttempts, failed ? "FAILED" : "OTP_SENT", current.id);
      this.db
        .prepare(
          "UPDATE checkout_sessions SET phone_verification_status=? WHERE store_id=? AND id=?",
        )
        .run(failed ? "FAILED" : "OTP_SENT", storeId, checkout.id);
      if (failed)
        throw new Error("Verification temporarily blocked. Request a new OTP later.");
      throw new Error(
        providerResult?.error ||
          `Incorrect OTP. ${settings.maxAttempts - nextAttempts} attempts remaining.`,
      );
    }
    const verifiedAt = timestamp();
    this.db
      .prepare(
        "UPDATE otp_verifications SET status='VERIFIED',verified_at=? WHERE id=?",
      )
      .run(verifiedAt, current.id);
    this.db
      .prepare(
        "UPDATE checkout_sessions SET phone_verification_status='VERIFIED',phone_verified_at=?,otp_required=1,updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND id=?",
      )
      .run(verifiedAt, storeId, checkout.id);
    return {
      status: "VERIFIED",
      maskedPhone: maskPhone(phone),
      verifiedAt,
    };
  }

  requireVerified(storeId, checkoutSessionId, { required }) {
    if (!required) return;
    const checkout = this.#checkout(storeId, checkoutSessionId);
    if (checkout.phone_verification_status !== "VERIFIED") {
      const error = new Error("Phone verification is required before confirming this COD order");
      error.otpRequired = true;
      error.checkoutSessionId = checkout.id;
      error.phone = checkout.phone;
      throw error;
    }
  }

  async testProvider(storeId, phoneValue, settings) {
    const phone = clean(phoneValue),
      provider = this.provider(storeId, settings?.provider);
    if (!/^[6-9][0-9]{9}$/.test(phone))
      throw new Error("Enter a valid 10-digit Indian mobile number");
    if (!provider?.send)
      throw new Error("OTP provider is not configured on the server");
    const otp = String(randomInt(100000, 1000000)),
      result = await provider.send({
        storeId,
        checkoutSessionId: "provider-test",
        phone,
        otp,
        expiresInMinutes: 5,
        test: true,
      });
    if (!result?.delivered) throw new Error(result?.error || "OTP delivery failed");
    return {
      delivered: true,
      provider: settings.provider,
      maskedPhone: maskPhone(phone),
    };
  }
}
