import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";

const clean = (value) => String(value ?? "").trim();

export function googleAuthConfiguration(env = process.env) {
  const clientId = clean(env.GOOGLE_CLIENT_ID),
    clientSecret = clean(env.GOOGLE_CLIENT_SECRET),
    baseUrl = clean(env.APP_BASE_URL).replace(/\/+$/, ""),
    redirectUri =
      clean(env.GOOGLE_REDIRECT_URI) ||
      (baseUrl ? `${baseUrl}/api/auth/google/callback` : "");
  return {
    clientId,
    clientSecret,
    redirectUri,
    enabled: Boolean(clientId && clientSecret && redirectUri),
  };
}

export function createGoogleAuthProvider(configuration = googleAuthConfiguration()) {
  if (!configuration.enabled) return null;
  const client = new OAuth2Client(
    configuration.clientId,
    configuration.clientSecret,
    configuration.redirectUri,
  );
  return {
    async begin({ state, nonce }) {
      const { codeVerifier, codeChallenge } =
        await client.generateCodeVerifierAsync();
      return {
        codeVerifier,
        authorizationUrl: client.generateAuthUrl({
          access_type: "online",
          scope: ["openid", "email", "profile"],
          state,
          nonce,
          prompt: "select_account",
          include_granted_scopes: true,
          code_challenge: codeChallenge,
          code_challenge_method: CodeChallengeMethod.S256,
        }),
      };
    },
    async complete({ code, codeVerifier, nonce }) {
      const { tokens } = await client.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw Error("Google did not return an identity token");
      const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: configuration.clientId,
        }),
        payload = ticket.getPayload();
      if (!payload || payload.nonce !== nonce)
        throw Error("Google sign-in verification failed");
      return {
        subject: clean(payload.sub),
        email: clean(payload.email).toLowerCase(),
        emailVerified: payload.email_verified === true,
        displayName: clean(payload.name) || clean(payload.email).split("@")[0],
        picture: /^https:\/\//i.test(clean(payload.picture))
          ? clean(payload.picture)
          : "",
      };
    },
  };
}
