export function createAccountEmailProvider(env = process.env, fetchImpl = globalThis.fetch) {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.APP_BASE_URL) return null;
  let base;
  try { base = new URL(env.APP_BASE_URL); } catch { return null; }
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) return null;
  return {
    async sendPasswordReset({ email, token }) {
      const link = new URL("/reset-password", base);
      // Fragment tokens stay out of HTTP access logs and Referer headers.
      link.hash = new URLSearchParams({ token }).toString();
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM, to: [email], subject: "Reset your Commera2 password",
          text: `Reset your Commera2 password using this link:\n\n${link.href}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, you can ignore this email.`,
        }),
      });
      if (!response.ok) throw Error("Password reset email could not be sent");
    },
  };
}
