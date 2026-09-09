// SQLite cannot extend a CHECK constraint in place. Preserve every row, index and
// trigger while replacing only the policy type constraint in one transaction.
export function migrateSubscriptionPolicy(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='store_policies'").get();
  if (!table || table.sql.includes("'subscription'")) return;
  const schema = table.sql.replace(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?store_policies["`]?/i, 'CREATE TABLE store_policies_subscription_migration')
    .replace("'contact','legal'", "'contact','legal','subscription'");
  if (!schema.includes("'subscription'")) throw Error('Unrecognized policy schema; migration was not applied');
  const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='store_policies' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(schema);
    db.exec('INSERT INTO store_policies_subscription_migration SELECT * FROM store_policies');
    db.exec('DROP TABLE store_policies');
    db.exec('ALTER TABLE store_policies_subscription_migration RENAME TO store_policies');
    for (const object of objects) db.exec(object.sql);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
