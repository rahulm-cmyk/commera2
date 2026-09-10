export function migrateAccountSecurity(db, postgres = false) {
  if (postgres) {
    db.exec("ALTER TABLE merchant_sessions ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'password'");
  } else if (!db.prepare("PRAGMA table_info(merchant_sessions)").all().some((c) => c.name === "auth_method")) {
    db.exec("ALTER TABLE merchant_sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    password_version TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON merchant_password_resets(user_id);`);
}
