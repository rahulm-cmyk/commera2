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
          `UPDATE merchant_users SET google_subject=?,display_name=?,picture_url=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
        )
        .run(subject, displayName, picture, existing.id);
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

  createSession(userId) {
    this.getUser(userId);
    const token = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(24).toString("base64url"),
      expiresAt = new Date(
        Date.now() + this.sessionHours * 60 * 60_000,
      ).toISOString();
    this.db
      .prepare(
        "INSERT INTO merchant_sessions (id,user_id,token_hash,csrf_token,expires_at) VALUES (?,?,?,?,?)",
      )
      .run(randomUUID(), userId, tokenHash(token), csrfToken, expiresAt);
    return { token, csrfToken, expiresAt };
  }

  authenticate(token) {
    if (!token) return null;
    const session = this.db
      .prepare(
        `SELECT ms.*,mu.email,mu.display_name,mu.active
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
      user: {
        id: session.user_id,
        email: session.email,
        displayName: session.display_name,
      },
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
