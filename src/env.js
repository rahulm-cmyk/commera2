import { existsSync } from "node:fs";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

if (existsSync(".env") && process.loadEnvFile) process.loadEnvFile(".env");

const emptyToUndefined = (value) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().optional());
const booleanFlag = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  return value;
}, z.boolean().default(false));

const formatEnvIssues = (issues) =>
  issues
    .map((issue) => `${issue.path.join(".") || "ENV"}: ${issue.message}`)
    .join("; ");

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(4173),
    RENDER: booleanFlag,
    DATABASE_MODE: z.enum(["auto", "postgres", "sqlite"]).default("auto"),
    DATABASE_URL: optionalString,
    APP_BASE_URL: optionalUrl,
    VISITOR_TOKEN_SECRET: optionalSecret,
    PREVIEW_TOKEN_SECRET: optionalSecret,
    AUTH_OAUTH_STATE_SECRET: optionalSecret,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalSecret,
    GOOGLE_REDIRECT_URI: optionalUrl,
    GOOGLE_SHEETS_REDIRECT_URI: optionalUrl,
    GOOGLE_SHEETS_CREDENTIALS_SECRET: optionalSecret,
    PIXEL_CREDENTIALS_SECRET: optionalSecret,
    OTP_CREDENTIALS_SECRET: optionalSecret,
    OTP_SECRET: optionalSecret,
    RESEND_API_KEY: optionalSecret,
    AUTH_EMAIL_FROM: optionalString,
    TYPESAFE_AI_ENABLED: booleanFlag,
    TYPESAFE_API_KEY: optionalSecret,
    TYPESAFE_MODEL: z.string().default("jev-latest"),
    DOMAIN_PLATFORM_HOST: optionalString,
    DOMAIN_CNAME_TARGET: optionalString,
    DOMAIN_APEX_TARGET: optionalString,
    DOMAIN_PROVIDER: z.string().default("manual"),
    DOMAIN_SSL_PROVIDER: optionalString,
    DOMAIN_SYNC_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    throw new Error(`Invalid environment setup: ${formatEnvIssues(issues)}`);
  },
});

const requireWhen = (condition, variable, message) => {
  if (condition && !env[variable])
    throw new Error(`Invalid environment setup: ${variable} is required ${message}.`);
};

const requireSecretLength = (variable, message) => {
  const value = env[variable];
  if (value && value.length < 32)
    throw new Error(`Invalid environment setup: ${variable} must be at least 32 characters ${message}.`);
};

requireWhen(
  env.DATABASE_MODE === "postgres",
  "DATABASE_URL",
  "when DATABASE_MODE is postgres",
);
requireWhen(
  env.RENDER && env.NODE_ENV === "production",
  "DATABASE_URL",
  "on Render production so store data is not lost",
);
requireWhen(
  Boolean(env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET),
  "GOOGLE_CLIENT_ID",
  "when Google login or Sheets is enabled",
);
requireWhen(
  Boolean(env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET),
  "GOOGLE_CLIENT_SECRET",
  "when Google login or Sheets is enabled",
);
requireWhen(
  Boolean(env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET),
  "APP_BASE_URL",
  "when Google login or Sheets is enabled",
);

if (env.NODE_ENV === "production") {
  requireWhen(true, "APP_BASE_URL", "in production");
  requireWhen(true, "VISITOR_TOKEN_SECRET", "in production");
  requireWhen(true, "PREVIEW_TOKEN_SECRET", "in production");
  requireWhen(true, "AUTH_OAUTH_STATE_SECRET", "in production");
}

for (const variable of [
  "VISITOR_TOKEN_SECRET",
  "PREVIEW_TOKEN_SECRET",
  "AUTH_OAUTH_STATE_SECRET",
  "GOOGLE_SHEETS_CREDENTIALS_SECRET",
  "PIXEL_CREDENTIALS_SECRET",
  "OTP_CREDENTIALS_SECRET",
  "OTP_SECRET",
]) {
  requireSecretLength(variable, "to protect production data");
}
