import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const normalizeEmail = (value) => clean(value).toLowerCase();
const tokenHash = (value) =>
  createHash("sha256").update(String(value || "")).digest("hex");
const publicUser = (value) => ({
  id: value.id,
  email: value.email,
  displayName: value.display_name,
  picture: value.picture_url || "",
  googleConnected: Boolean(value.google_subject),
  hasPassword: Boolean(value.password_hash),
});

function passwordHash(password) {
  const salt = randomBytes(16).toString("hex"),
    derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(password, stored) {
  const [algorithm, salt, expected] = clean(stored).split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
const fallbackPasswordHash = passwordHash(randomBytes(24).toString("hex"));

function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password.length < 10 || password.length > 256 ||
      !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    throw Error("Password must be 10-256 characters and include a letter and number");
  if (password !== confirmation) throw Error("Passwords do not match");
}

function validatedAccount(input) {
  const email = normalizeEmail(input.email),
    displayName = clean(input.displayName).replace(/\s+/g, " "),
    password = String(input.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw Error("Enter a valid email address");
  if (displayName.length < 2 || displayName.length > 100)
    throw Error("Name must be between 2 and 100 characters");
  if (
    password.length < 10 ||
    password.length > 256 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  )
    throw Error("Password must be 10-256 characters and include a letter and number");
  return { email, displayName, password };
}

export class AuthService {
  constructor(db, { sessionHours = 24 * 7 } = {}) {
    this.db = db;
    this.sessionHours = sessionHours;
  }

  register(input) {
    if (input.confirmPassword !== undefined && input.password !== input.confirmPassword)
      throw Error("Passwords do not match");
    const account = validatedAccount(input),
      id = randomUUID(),
      firstUser =
        Number(this.db.prepare("SELECT COUNT(*) count FROM merchant_users").get().count) ===
        0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO merchant_users (id,email,display_name,password_hash) VALUES (?,?,?,?)",
        )
        .run(id, account.email, account.displayName, passwordHash(account.password));
      if (firstUser)
        this.db
          .prepare(
            `INSERT INTO store_memberships (user_id,store_id,role)
             SELECT ?,s.id,'owner' FROM stores s
             WHERE NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.store_id=s.id)`,
          )
          .run(id);
      this.db.exec("COMMIT");
      return publicUser(this.getUser(id));
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (/unique/i.test(String(error.message)))
        throw Error("An account with this email already exists");
      throw error;
    }
  }

  login(input) {
    const email = normalizeEmail(input.email),
      password = String(input.password || ""),
      user = this.db
        .prepare("SELECT * FROM merchant_users WHERE email=? AND active=1")
        .get(email);
    const validPassword = passwordMatches(
      password,
      user?.password_hash || fallbackPasswordHash,
    );
    if (!user || !validPassword)
      throw Error("Email or password is incorrect");
    return publicUser(user);
  }

  loginWithGoogle(input) {
    const subject = clean(input.subject),
      email = normalizeEmail(input.email),
      displayName = clean(input.displayName).replace(/\s+/g, " "),
      picture = /^https:\/\//i.test(clean(input.picture)) ? clean(input.picture) : "";
    if (!subject || subject.length > 255)
      throw Error("Google account identifier is invalid");
    if (!input.emailVerified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw Error("Google did not provide a verified email address");
    if (displayName.length < 2 || displayName.length > 100)
      throw Error("Google account name is invalid");

    const bySubject = this.db
        .prepare("SELECT * FROM merchant_users WHERE google_subject=?")
        .get(subject),
      byEmail = this.db
        .prepare("SELECT * FROM merchant_users WHERE email=?")
        .get(email),
      existing = bySubject || byEmail;
    if (bySubject && byEmail && bySubject.id !== byEmail.id)
      throw Error("This Google account conflicts with an existing account");
    if (existing && !existing.active) throw Error("Account is disabled");

    if (existing) {
      if (existing.google_subject && existing.google_subject !== subject)
        throw Error("This email is already linked to another Google account");
      this.db
        .prepare(
          `UPDATE merchant_users SET google_subject=?,picture_url=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
        )
        .run(subject, picture, existing.id);
      return publicUser(this.getUser(existing.id));
    }

    const id = randomUUID(),
      firstUser =
        Number(this.db.prepare("SELECT COUNT(*) count FROM merchant_users").get().count) ===
        0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO merchant_users
           (id,email,display_name,password_hash,google_subject,picture_url)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(id, email, displayName, "", subject, picture);
      if (firstUser)
        this.db
          .prepare(
            `INSERT INTO store_memberships (user_id,store_id,role)
             SELECT ?,s.id,'owner' FROM stores s
             WHERE NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.store_id=s.id)`,
          )
          .run(id);
      this.db.exec("COMMIT");
      return publicUser(this.getUser(id));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getUser(id) {
    const user = this.db
      .prepare("SELECT * FROM merchant_users WHERE id=? AND active=1")
      .get(id);
    if (!user) throw Error("Account not found");
    return user;
  }

  createSession(userId, method = "password") {
    this.getUser(userId);
    const token = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(24).toString("base64url"),
      expiresAt = new Date(
        Date.now() + this.sessionHours * 60 * 60_000,
      ).toISOString();
    this.db
      .prepare(
        "INSERT INTO merchant_sessions (id,user_id,token_hash,csrf_token,expires_at,auth_method,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(randomUUID(), userId, tokenHash(token), csrfToken, expiresAt, method, new Date().toISOString());
    return { token, csrfToken, expiresAt };
  }

  authenticate(token) {
    if (!token) return null;
    const session = this.db
      .prepare(
        `SELECT ms.*,mu.email,mu.display_name,mu.active,mu.google_subject,mu.picture_url,mu.password_hash
         FROM merchant_sessions ms JOIN merchant_users mu ON mu.id=ms.user_id
         WHERE ms.token_hash=?`,
      )
      .get(tokenHash(token));
    if (!session || !session.active) return null;
    if (Date.parse(session.expires_at) <= Date.now()) {
      this.db
        .prepare("DELETE FROM merchant_sessions WHERE id=?")
        .run(session.id);
      return null;
    }
    return {
      sessionId: session.id,
      user: publicUser({ ...session, id: session.user_id }),
      authMethod: session.auth_method,
      createdAt: session.created_at,
      csrfToken: session.csrf_token,
      expiresAt: session.expires_at,
    };
  }

  logout(token) {
    if (token)
      this.db
        .prepare("DELETE FROM merchant_sessions WHERE token_hash=?")
        .run(tokenHash(token));
    return { loggedOut: true };
  }

  security(session) {
    return {
      user: publicUser(this.getUser(session.user.id)),
      authMethod: session.authMethod,
      canSetPassword: this.recentGoogleSession(session),
      sessions: this.db.prepare(
        "SELECT id,auth_method,created_at,expires_at FROM merchant_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC",
      ).all(session.user.id, new Date().toISOString()).map((row) => ({
        id: row.id, current: row.id === session.sessionId,
        method: row.auth_method, createdAt: row.created_at, expiresAt: row.expires_at,
      })),
    };
  }

  recentGoogleSession(session) {
    const raw = String(session.createdAt || "").replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
      created = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : raw + "Z"),
      age = Date.now() - created;
    return session.authMethod === "google" && age >= 0 && age < 5 * 60_000;
  }

  updateProfile(userId, input) {
    const name = clean(input.displayName).replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100) throw Error("Name must be between 2 and 100 characters");
    this.db.prepare("UPDATE merchant_users SET display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(name, userId);
    return publicUser(this.getUser(userId));
  }

  changePassword(session, input) {
    validatePassword(input.password, input.confirmPassword);
    const user = this.getUser(session.user.id);
    if (user.password_hash && !this.recentGoogleSession(session)) {
      if (!passwordMatches(String(input.currentPassword || ""), user.password_hash))
        throw Error("Current password is incorrect");
    } else if (!user.password_hash && !this.recentGoogleSession(session)) {
      throw Error("Sign in with Google again before setting a password");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changed = this.db.prepare("UPDATE merchant_users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND password_hash=?")
        .run(passwordHash(input.password), user.id, user.password_hash);
      if (!changed.changes) throw Error("Account changed. Sign in again and retry");
      this.db.prepare("DELETE FROM merchant_sessions WHERE user_id=?").run(user.id);
      this.db.prepare("DELETE FROM merchant_password_resets WHERE user_id=?").run(user.id);
      const replacement = this.createSession(user.id, "password");
      this.db.exec("COMMIT");
      return replacement;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  revokeSession(userId, sessionId) {
    this.db.prepare("DELETE FROM merchant_sessions WHERE user_id=? AND id=?").run(userId, sessionId);
  }

  revokeOtherSessions(session) {
    this.db.prepare("DELETE FROM merchant_sessions WHERE user_id=? AND id<>?").run(session.user.id, session.sessionId);
  }

  requestPasswordReset(email) {
    const user = this.db.prepare("SELECT * FROM merchant_users WHERE email=? AND active=1").get(normalizeEmail(email));
    if (!user) return null;
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM merchant_password_resets WHERE expires_at<=?").run(new Date().toISOString());
    this.db.prepare("INSERT INTO merchant_password_resets (token_hash,user_id,password_version,expires_at) VALUES (?,?,?,?)")
      .run(tokenHash(token), user.id, tokenHash(user.password_hash), new Date(Date.now() + 30 * 60_000).toISOString());
    return { token, email: user.email };
  }

  cancelPasswordReset(token) {
    this.db.prepare("DELETE FROM merchant_password_resets WHERE token_hash=?").run(tokenHash(token));
  }

  resetPassword(input) {
    validatePassword(input.password, input.confirmPassword);
    const reset = this.db.prepare("SELECT * FROM merchant_password_resets WHERE token_hash=? AND expires_at>?")
      .get(tokenHash(input.token), new Date().toISOString());
    if (!reset) throw Error("This reset link is invalid or expired. Request a new link");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Lock the account before checking the token so concurrent resets cannot both succeed.
      this.db.prepare("UPDATE merchant_users SET active=active WHERE id=?").run(reset.user_id);
      const user = this.getUser(reset.user_id),
        valid = this.db.prepare("SELECT token_hash FROM merchant_password_resets WHERE token_hash=? AND expires_at>?")
          .get(tokenHash(input.token), new Date().toISOString());
      if (!valid || tokenHash(user.password_hash) !== reset.password_version)
        throw Error("This reset link is invalid or expired. Request a new link");
      this.db.prepare("UPDATE merchant_users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(passwordHash(input.password), user.id);
      this.db.prepare("DELETE FROM merchant_password_resets WHERE user_id=?").run(user.id);
      this.db.prepare("DELETE FROM merchant_sessions WHERE user_id=?").run(user.id);
      this.db.exec("COMMIT");
      return { reset: true };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  addStore(userId, storeId, role = "owner") {
    if (!["owner", "admin", "editor", "viewer"].includes(role))
      throw Error("Invalid store role");
    this.getUser(userId);
    this.db
      .prepare(
        "INSERT INTO store_memberships (user_id,store_id,role) VALUES (?,?,?) ON CONFLICT(user_id,store_id) DO UPDATE SET role=excluded.role",
      )
      .run(userId, storeId, role);
    return this.membership(userId, storeId);
  }

  membership(userId, storeId) {
    const membership = this.db
      .prepare(
        `SELECT sm.role,s.id store_id,s.name store_name
         FROM store_memberships sm JOIN stores s ON s.id=sm.store_id
         WHERE sm.user_id=? AND sm.store_id=?`,
      )
      .get(userId, Number(storeId));
    if (!membership) throw Error("You do not have access to this store");
    return {
      storeId: Number(membership.store_id),
      storeName: membership.store_name,
      role: membership.role,
    };
  }

  requireStore(userId, storeId, { write = false } = {}) {
    const membership = this.membership(userId, storeId);
    if (write && membership.role === "viewer")
      throw Error("This store role has read-only access");
    return membership;
  }

  listStores(userId) {
    return this.db
      .prepare(
        `SELECT s.*,sm.role FROM stores s JOIN store_memberships sm ON sm.store_id=s.id
         WHERE sm.user_id=? ORDER BY s.id`,
      )
      .all(userId);
  }
}
