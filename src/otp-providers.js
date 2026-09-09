const clean = (value) => String(value ?? "").trim();

const providerError = async (response) => {
  let detail = "";
  try {
    const payload = await response.json();
    detail = clean(payload.message || payload.detail || payload.code);
  } catch {}
  return detail || `Twilio Verify request failed (${response.status})`;
};

export function createTwilioVerifyProvider({
  apiKeySid,
  apiKeySecret,
  accountSid,
  authToken,
  serviceSid,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = clean(apiKeySid), secret = clean(apiKeySecret), account = clean(accountSid), token = clean(authToken), service = clean(serviceSid);
  const apiKeyConfigured = key || secret;
  const accountConfigured = account || token;
  if (!apiKeyConfigured && !accountConfigured) throw new Error("Twilio credentials are required");
  if (apiKeyConfigured && (!/^SK[0-9a-f]{32}$/i.test(key) || !secret))
    throw new Error("TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be valid");
  if (!apiKeyConfigured && (!/^AC[0-9a-f]{32}$/i.test(account) || !token))
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be valid");
  if (!/^VA[0-9a-f]{32}$/i.test(service)) throw new Error("TWILIO_VERIFY_SERVICE_SID must be a valid VA SID");
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable");
  const username = apiKeyConfigured ? key : account, password = apiKeyConfigured ? secret : token,
    authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    verificationEndpoint = `https://verify.twilio.com/v2/Services/${service}/Verifications`,
    checkEndpoint = `https://verify.twilio.com/v2/Services/${service}/VerificationCheck`;
  return {
    name: "Twilio Verify",
    managesCode: true,
    async send({ phone }) {
      try {
        const response = await fetchImpl(verificationEndpoint, {
          method: "POST",
          headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: `+91${clean(phone)}`, Channel: "sms" }).toString(),
        });
        if (!response.ok) return { delivered: false, error: await providerError(response) };
        const payload = await response.json(), delivered = payload.status === "pending" && /^VE[0-9a-f]{32}$/i.test(clean(payload.sid));
        return { delivered, reference: clean(payload.sid), error: delivered ? "" : `Twilio returned ${clean(payload.status) || "an unknown status"}` };
      } catch (error) {
        return { delivered: false, error: `Twilio Verify is unavailable: ${clean(error.message)}` };
      }
    },
    async verify({ phone, otp }) {
      try {
        const response = await fetchImpl(checkEndpoint, {
          method: "POST",
          headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: `+91${clean(phone)}`, Code: clean(otp) }).toString(),
        });
        if (!response.ok) return { verified: false, error: await providerError(response) };
        const payload = await response.json(), verified = payload.status === "approved";
        return {
          verified,
          reference: clean(payload.sid),
          error: verified ? "" : "Incorrect or expired OTP",
        };
      } catch (error) {
        return { verified: false, error: `Twilio Verify is unavailable: ${clean(error.message)}` };
      }
    },
  };
}

export function configuredOtpProviders(env = process.env, options = {}) {
  const apiKeyConfigured = [env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET].every((value) => clean(value));
  const accountConfigured = [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN].every((value) => clean(value));
  const configured = clean(env.TWILIO_VERIFY_SERVICE_SID) && (apiKeyConfigured || accountConfigured);
  if (!configured) return {};
  return { twilio: createTwilioVerifyProvider({
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    serviceSid: env.TWILIO_VERIFY_SERVICE_SID,
    fetchImpl: options.fetchImpl,
  }) };
}
