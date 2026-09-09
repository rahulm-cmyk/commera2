import { randomUUID } from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const dbTimestamp = (value) =>
  new Date(value).toISOString().replace("T", " ").replace("Z", "");
const safeBehavior = (value) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value || {};
    return {
      timeOnPageMs: Math.max(0, Number(parsed.timeOnPageMs) || 0),
      pointerEvents: Math.max(0, Number(parsed.pointerEvents) || 0),
      touchEvents: Math.max(0, Number(parsed.touchEvents) || 0),
      scrollEvents: Math.max(0, Number(parsed.scrollEvents) || 0),
      focusEvents: Math.max(0, Number(parsed.focusEvents) || 0),
      corrections: Math.max(0, Number(parsed.corrections) || 0),
    };
  } catch {
    return {
      timeOnPageMs: 0,
      pointerEvents: 0,
      touchEvents: 0,
      scrollEvents: 0,
      focusEvents: 0,
      corrections: 0,
    };
  }
};

export class BotProtectionService {
  constructor(db, { ipReputationProvider, challengeProvider } = {}) {
    this.db = db;
    this.ipReputationProvider = ipReputationProvider;
    this.challengeProvider = challengeProvider;
  }

  async assess(storeId, input, { ipAddress = "", settings, tokenValid = false } = {}) {
    const bot = settings || {},
      id = randomUUID(),
      phone = clean(input.phone),
      deviceId = clean(input.deviceId),
      visitorSessionId = clean(input.visitorSessionId),
      behavior = safeBehavior(input.behavior),
      signals = [];
    let score = 0,
      forcedAction = "";
    const add = (points, code, detail) => {
      score += points;
      signals.push({ code, points, detail });
    };
    if (!bot.enabled) {
      const result = {
        id,
        score: 0,
        level: "low",
        action: "allow",
        signals: [],
        behavior,
      };
      this.#record(storeId, input, { ipAddress, deviceId, visitorSessionId }, result);
      return result;
    }
    if (bot.honeypot && clean(input.website)) {
      add(100, "honeypot", "Invisible checkout field was completed");
      forcedAction = "block";
    }
    if (bot.checkoutToken && !tokenValid) {
      add(10, "invalid_checkout_token", "Checkout token is missing or invalid");
      forcedAction = "block";
    }
    if (bot.rateLimiting && ipAddress) {
      const ipCount = Number(
        this.db
          .prepare(
            "SELECT COUNT(*) count FROM cod_bot_attempts WHERE store_id=? AND ip_address=? AND created_at>=?",
          )
          .get(
            storeId,
            ipAddress,
            dbTimestamp(Date.now() - bot.ipWindowMinutes * 60_000),
          ).count,
      );
      if (ipCount >= bot.ipCheckoutLimit)
        add(25, "ip_velocity", `${ipCount} recent checkout attempts from this IP`);
    }
    if (bot.deviceSessionCheck) {
      if (!deviceId || !visitorSessionId)
        add(10, "missing_session", "Device or visitor session identity is missing");
      if (deviceId) {
        const deviceStats = this.db
          .prepare(
            "SELECT COUNT(*) count,COUNT(DISTINCT phone) phones FROM cod_bot_attempts WHERE store_id=? AND device_id=? AND created_at>=?",
          )
          .get(
            storeId,
            deviceId,
            dbTimestamp(Date.now() - bot.deviceWindowMinutes * 60_000),
          );
        if (Number(deviceStats.count) >= bot.deviceAttemptLimit)
          add(
            20,
            "device_velocity",
            `${deviceStats.count} attempts from this device`,
          );
        if (Number(deviceStats.phones) >= 3)
          add(20, "multiple_identities", "Device used multiple phone identities");
      }
    }
    if (bot.behaviorDetection && input.intent === "submit") {
      if (behavior.timeOnPageMs > 0 && behavior.timeOnPageMs < 1500)
        add(15, "abnormally_fast", "Checkout completed in under 1.5 seconds");
      if (
        behavior.pointerEvents +
          behavior.touchEvents +
          behavior.scrollEvents +
          behavior.focusEvents ===
        0
      )
        add(10, "no_human_interaction", "No human interaction signals were observed");
    }
    const failedOtp = Number(
      this.db
        .prepare(
          "SELECT COUNT(*) count FROM otp_verifications WHERE store_id=? AND phone=? AND status='FAILED' AND created_at>=?",
        )
        .get(storeId, phone, dbTimestamp(Date.now() - 60 * 60_000)).count,
    );
    if (phone && failedOtp) add(10, "failed_otp", "Recent OTP verification failures");
    if (
      phone &&
      this.db
        .prepare("SELECT 1 FROM customers WHERE store_id=? AND phone=?")
        .get(storeId, phone)
    )
      add(-8, "returning_customer", "Previous successful customer");
    if (bot.ipReputationCheck) {
      if (this.ipReputationProvider?.check) {
        const reputation = await this.ipReputationProvider.check({
          storeId,
          ipAddress,
        });
        if (reputation?.bad) {
          add(30, "bad_ip_reputation", reputation.reason || "Known bad IP");
          if (bot.blockKnownBadIps) forcedAction = "block";
        }
      } else
        signals.push({
          code: "ip_reputation_unavailable",
          points: 0,
          detail: "IP reputation provider is not configured",
        });
    }
    score = Math.max(0, Math.min(100, score));
    const level =
        score >= 80
          ? "critical"
          : score >= 60
            ? "high"
            : score >= 30
              ? "medium"
              : "low",
      configuredAction =
        level === "critical"
          ? bot.criticalRiskAction
          : level === "high"
            ? bot.highRiskAction
            : level === "medium" && bot.otpSuspiciousTraffic
              ? "require_otp"
              : "allow";
    let action = forcedAction || configuredAction;
    if (action === "challenge") {
      if (!this.challengeProvider?.verify) {
        signals.push({
          code: "challenge_unavailable",
          points: 0,
          detail: "Challenge provider is not configured; request blocked safely",
        });
        action = "block";
      } else {
        const challenge = await this.challengeProvider.verify({
          storeId,
          token: clean(input.challengeToken),
          ipAddress,
        });
        action = challenge?.passed ? "allow" : "block";
      }
    }
    if (action === "require_otp" && bot.otpEnabled === false) {
      signals.push({
        code: "otp_disabled",
        points: 0,
        detail: "OTP verification is disabled; adaptive OTP requirement skipped",
      });
      action = "allow";
    }
    const result = { id, score, level, action, signals, behavior };
    this.#record(storeId, input, { ipAddress, deviceId, visitorSessionId }, result);
    if (action === "block" && visitorSessionId)
      this.db
        .prepare(
          "UPDATE live_visitor_sessions SET is_bot=1 WHERE store_id=? AND session_id=?",
        )
        .run(storeId, visitorSessionId);
    return result;
  }

  #record(storeId, input, context, result) {
    this.db
      .prepare(
        "INSERT INTO cod_bot_attempts (id,store_id,visitor_session_id,phone,device_id,ip_address,risk_score,risk_level,action,signals_json,blocked) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        result.id,
        storeId,
        context.visitorSessionId,
        clean(input.phone),
        context.deviceId,
        clean(context.ipAddress),
        result.score,
        result.level,
        result.action,
        JSON.stringify(result.signals),
        result.action === "block" ? 1 : 0,
      );
  }

  linkCheckout(storeId, attemptId, checkoutSessionId) {
    this.db
      .prepare(
        "UPDATE cod_bot_attempts SET checkout_session_id=? WHERE store_id=? AND id=?",
      )
      .run(checkoutSessionId, storeId, attemptId);
  }

  list(storeId) {
    return this.db
      .prepare(
        "SELECT * FROM cod_bot_attempts WHERE store_id=? ORDER BY created_at DESC,id DESC LIMIT 200",
      )
      .all(storeId)
      .map((item) => {
        let signals = [];
        try {
          signals = JSON.parse(item.signals_json || "[]");
        } catch {}
        return {
          id: item.id,
          visitorSessionId: item.visitor_session_id,
          checkoutSessionId: item.checkout_session_id,
          phone: item.phone,
          deviceId: item.device_id,
          ipAddress: item.ip_address,
          riskScore: Number(item.risk_score),
          riskLevel: item.risk_level,
          action: item.action,
          signals,
          blocked: Boolean(item.blocked),
          createdAt: item.created_at,
        };
      });
  }
}
