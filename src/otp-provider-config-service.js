import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createTwilioVerifyProvider } from "./otp-providers.js";

const clean = (value) => String(value ?? "").trim();
const validAccountSid = (value) => /^AC[0-9a-f]{32}$/i.test(clean(value));
const validServiceSid = (value) => /^VA[0-9a-f]{32}$/i.test(clean(value));
const maskSid = (value) => {
  const sid = clean(value);
  return sid ? `${sid.slice(0, 2)}••••••••${sid.slice(-4)}` : "";
};

export class OtpProviderConfigService {
  constructor(
    db,
    {
      credentialSecret =
        process.env.OTP_CREDENTIALS_SECRET ||
        process.env.PIXEL_CREDENTIALS_SECRET ||
        "",
      fetchImpl = globalThis.fetch,
      fallbackEnv = process.env,
    } = {},
  ) {
    this.db = db;
    this.fetchImpl = fetchImpl;
    this.fallbackEnv = fallbackEnv;
    const secret =
      credentialSecret ||
      (process.env.NODE_ENV === "production"
        ? ""
        : "commera2-local-development-otp-credential-key");
    this.credentialKey = secret
      ? createHash("sha256").update(secret).digest()
      : null;
  }

  #store(storeId) {
    if (!this.db.prepare("SELECT id FROM stores WHERE id=?").get(storeId))
      throw new Error("Store not found");
  }

  #row(storeId) {
    return this.db
      .prepare("SELECT * FROM otp_provider_connections WHERE store_id=?")
      .get(storeId);
  }

  #encrypt(credentials) {
    if (!this.credentialKey)
      throw new Error(
        "Set OTP_CREDENTIALS_SECRET before saving OTP provider credentials",
      );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.credentialKey, iv),
      ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(credentials), "utf8"),
        cipher.final(),
      ]),
      tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  #decrypt(value) {
    if (!value || !this.credentialKey) return {};
    try {
      const [, iv, tag, ciphertext] = String(value).split(":"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          this.credentialKey,
          Buffer.from(iv, "base64url"),
        );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      return {};
    }
  }

  #environmentCredentials() {
    const accountSid = clean(this.fallbackEnv.TWILIO_ACCOUNT_SID),
      authToken = clean(this.fallbackEnv.TWILIO_AUTH_TOKEN),
      serviceSid = clean(this.fallbackEnv.TWILIO_VERIFY_SERVICE_SID);
    return validAccountSid(accountSid) && authToken && validServiceSid(serviceSid)
      ? { accountSid, authToken, serviceSid }
      : {};
  }

  #credentials(storeId) {
    const row = this.#row(storeId);
    return row ? this.#decrypt(row.credentials_json) : this.#environmentCredentials();
  }

  #safeError(error, credentials = {}) {
    let message = clean(error?.message) || "Twilio connection failed";
    for (const value of Object.values(credentials)) {
      const sensitive = clean(value);
      if (sensitive.length >= 4)
        message = message.replaceAll(sensitive, "[redacted]");
    }
    return message.slice(0, 500);
  }

  async #twilioRequest(path, credentials, { method = "POST", body } = {}) {
    if (typeof this.fetchImpl !== "function") throw new Error("Fetch is unavailable");
    const response = await this.fetchImpl(`https://verify.twilio.com/v2${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
        ...(body
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {}
    if (!response.ok)
      throw new Error(
        clean(payload.message || payload.detail) ||
          `Twilio request failed (${response.status})`,
      );
    return payload;
  }

  async #validateTwilioAccount(credentials) {
    if (typeof this.fetchImpl !== "function") throw new Error("Fetch is unavailable");
    const response = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
      {
        headers: {
          authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`,
        },
      },
    );
    let payload = {};
    try {
      payload = await response.json();
    } catch {}
    if (!response.ok || payload.status !== "active")
      throw new Error(
        clean(payload.message) ||
          `Twilio account validation failed (${response.status})`,
      );
    return payload;
  }

  status(storeId) {
    this.#store(storeId);
    const row = this.#row(storeId),
      credentials = row ? this.#decrypt(row.credentials_json) : this.#environmentCredentials(),
      configured =
        validAccountSid(credentials.accountSid) &&
        Boolean(clean(credentials.authToken)) &&
        validServiceSid(credentials.serviceSid);
    return {
      provider: "twilio",
      configured,
      status: configured ? row?.status || "connected" : "not_connected",
      region: row?.region || "US1",
      accountSidHint: maskSid(credentials.accountSid),
      serviceSidHint: maskSid(credentials.serviceSid),
      authTokenConfigured: Boolean(clean(credentials.authToken)),
      source: row ? "store" : configured ? "server" : "none",
      verifiedAt: row?.verified_at || null,
      lastError: row?.last_error || "",
    };
  }

  provider(storeId, name) {
    if (name !== "twilio") return null;
    const credentials = this.#credentials(storeId);
    if (
      !validAccountSid(credentials.accountSid) ||
      !clean(credentials.authToken) ||
      !validServiceSid(credentials.serviceSid)
    )
      return null;
    return createTwilioVerifyProvider({
      ...credentials,
      fetchImpl: this.fetchImpl,
    });
  }

  async connect(storeId, input = {}, { friendlyName = "Commera2 OTP" } = {}) {
    this.#store(storeId);
    const existing = this.#credentials(storeId),
      credentials = {
        accountSid: clean(input.accountSid) || existing.accountSid,
        authToken: clean(input.authToken) || existing.authToken,
        serviceSid: clean(input.serviceSid) || existing.serviceSid,
      },
      region = clean(input.region || "US1").toUpperCase();
    if (region !== "US1") throw new Error("Only Twilio US1 is available in this build");
    if (!validAccountSid(credentials.accountSid))
      throw new Error("Enter a valid Twilio Account SID beginning with AC");
    if (!clean(credentials.authToken)) throw new Error("Enter the Twilio Auth Token");
    try {
      const account = await this.#validateTwilioAccount(credentials);
      if (!validServiceSid(credentials.serviceSid)) {
        const created = await this.#twilioRequest("/Services", credentials, {
          body: {
            FriendlyName: clean(friendlyName) || "Commera2 OTP",
            CodeLength: "6",
            DoNotShareWarningEnabled: "true",
          },
        });
        if (!validServiceSid(created.sid))
          throw new Error("Twilio did not return a valid Verify Service SID");
        credentials.serviceSid = clean(created.sid);
      } else if (clean(account.type).toLowerCase() !== "trial") {
        await this.#twilioRequest(`/Services/${credentials.serviceSid}`, credentials, {
          method: "GET",
        });
      }
      const encrypted = this.#encrypt(credentials);
      this.db
        .prepare(
          `INSERT INTO otp_provider_connections
           (store_id,provider,region,account_identifier,service_identifier,credentials_json,status,verified_at,last_error)
           VALUES (?,'twilio',?,?,?,?, 'connected',CURRENT_TIMESTAMP,'')
           ON CONFLICT(store_id) DO UPDATE SET
             provider='twilio',region=excluded.region,
             account_identifier=excluded.account_identifier,
             service_identifier=excluded.service_identifier,
             credentials_json=excluded.credentials_json,status='connected',
             verified_at=CURRENT_TIMESTAMP,last_error='',updated_at=CURRENT_TIMESTAMP`,
        )
        .run(
          storeId,
          region,
          credentials.accountSid,
          credentials.serviceSid,
          encrypted,
        );
      return this.status(storeId);
    } catch (error) {
      throw new Error(this.#safeError(error, credentials));
    }
  }
}
