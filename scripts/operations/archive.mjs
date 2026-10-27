import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const MAGIC = Buffer.from('EPILESS-BACKUP-1\n');
/**
 * @param {string | undefined} value
 */
export function archiveKey(value) {
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error('EPI_LESS_BACKUP_KEY must be a private 32-byte hex key.');
  return Buffer.from(value, 'hex');
}
/**
 * @param {unknown} value
 * @param {import("node:crypto").CipherKey} key
 */
export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}
/**
 * @param {Buffer} bytes
 * @param {import("node:crypto").CipherKey} key
 */
export function unseal(bytes, key) {
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('Unsupported archive.');
  const offset = MAGIC.length;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    bytes.subarray(offset, offset + 12),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(offset + 28)),
      decipher.final(),
    ])
      .toString()
      .toString(),
  );
}
const ident = (/** @type {string} */ name) => `"${name.replaceAll('"', '""')}"`;
const literal = (/** @type {import("node:sqlite").SQLOutputValue} */ value) =>
  value === null
    ? 'NULL'
    : typeof value === 'string'
      ? value.includes('\0')
        ? `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`
        : `'${value.replaceAll("'", "''")}'`
      : value instanceof Uint8Array
        ? `X'${Buffer.from(value).toString('hex')}'`
        : String(value);

/** Export tables first, then indexes/triggers, so guards never replay writes. */
/**
 * @param {import("node:sqlite").DatabaseSync} db
 */
export function dumpDatabase(db) {
  /** @type {{type: string; name: string; sql: string}[]} */
  const objects = /** @type {{type: string; name: string; sql: string}[]} */ (
    db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name",
      )
      .all()
  );
  const sql = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  for (const object of objects.filter((row) => row.type === 'table')) {
    sql.push(`${object.sql};`);
    const columns = db
      .prepare(`PRAGMA table_info(${ident(object.name)})`)
      .all()
      .map((row) => {
        if (typeof row.name !== 'string')
          throw new Error('Invalid column name');
        return row.name;
      });
    const statement = db.prepare(`SELECT * FROM ${ident(object.name)}`);
    statement.setReadBigInts(true);
    for (const row of statement.iterate())
      sql.push(
        `INSERT INTO ${ident(object.name)} (${columns.map(ident).join(',')}) VALUES (${columns.map((column) => literal(row[column])).join(',')});`,
      );
  }
  for (const object of objects.filter((row) => row.type !== 'table'))
    sql.push(`${object.sql};`);
  sql.push('COMMIT;', 'PRAGMA foreign_keys=ON;');
  return sql.join('\n');
}

/** Prepare an isolated restore. Never connects to a live database. */
/**
 * @param {import("../helper-types.js").DatabaseArchive} backup
 * @param {import("../helper-types.js").ErasureLedger} ledger
 */
export function prepareRestore(backup, ledger, now = Date.now()) {
  if (
    backup.kind !== 'database' ||
    ledger.kind !== 'erasure-ledger' ||
    backup.schemaVersion !== 1 ||
    ledger.schemaVersion !== 1
  )
    throw new Error('Wrong archive kind/version.');
  if (ledger.database !== backup.database)
    throw new Error('Database identity differs.');
  if (
    !Number.isFinite(ledger.capturedAt) ||
    now - ledger.capturedAt > 5 * 60_000 ||
    ledger.capturedAt > now + 30_000 ||
    ledger.capturedAt < backup.capturedAt
  )
    throw new Error(
      'Export a fresh erasure ledger while writes are paused (maximum age five minutes).',
    );
  if (!Array.isArray(ledger.events)) throw new Error('Invalid erasure ledger.');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(backup.sql);
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    for (const event of ledger.events) {
      if (
        !['account', 'publication'].includes(event.entity_type) ||
        typeof event.entity_id !== 'string' ||
        !['delete', 'revoke', 'visibility', 'rotate-link'].includes(
          event.action,
        )
      )
        throw new Error('Invalid erasure event.');
      if (event.entity_type === 'account' && event.action === 'delete') {
        const id = event.entity_id;
        db.prepare(
          'DELETE FROM abuse_reports WHERE reporter_id=? OR publication_id IN (SELECT id FROM publications WHERE owner_id=?)',
        ).run(id, id);
        db.prepare(
          'DELETE FROM moderation_events WHERE moderator_id=? OR publication_id IN (SELECT id FROM publications WHERE owner_id=?)',
        ).run(id, id);
        db.prepare('DELETE FROM publications WHERE owner_id=?').run(id);
        db.prepare('DELETE FROM challenges WHERE owner_id=?').run(id);
        db.prepare('DELETE FROM publication_intents WHERE owner_id=?').run(id);
        db.prepare('DELETE FROM account_usage WHERE owner_id=?').run(id);
        db.prepare('DELETE FROM daily_usage WHERE owner_id=?').run(id);
        db.prepare('DELETE FROM session WHERE userId=?').run(id);
        db.prepare('DELETE FROM account WHERE userId=?').run(id);
        db.prepare('DELETE FROM user WHERE id=?').run(id);
      } else if (
        event.entity_type === 'publication' &&
        event.action === 'delete'
      ) {
        db.prepare(
          "UPDATE publications SET report_json='{}',size_bytes=0,origin='https://deleted.invalid',author_name='[deleted]',status='ERROR',route_count=0 WHERE id=?",
        ).run(event.entity_id);
        db.prepare(
          "UPDATE moderation_events SET reason='[report deleted]' WHERE publication_id=?",
        ).run(event.entity_id);
      }
      db.prepare(
        'INSERT OR IGNORE INTO erasure_log(id,entity_type,entity_id,action,revision,created_at) VALUES(?,?,?,?,?,?)',
      ).run(
        event.id,
        event.entity_type,
        event.entity_id,
        event.action,
        event.revision ?? null,
        event.created_at,
      );
    }
    // A restored snapshot cannot prove more recent sharing state: require deliberate republication.
    db.prepare(
      "UPDATE publications SET state='REVOKED',visibility='PRIVATE',revision=revision+1,share_version=share_version+1,token_hash='',revoked_at=?",
    ).run(now);
    // Never restore login cookies, mail tokens, or outstanding publication approvals.
    db.exec(
      "DELETE FROM session; DELETE FROM verification; DELETE FROM challenges; UPDATE publication_intents SET state='EXPIRED',report_json=NULL,verified_until=NULL,canceled_at=COALESCE(canceled_at,CAST(strftime('%s','now') AS INTEGER)*1000); UPDATE account SET password=NULL,accessToken=NULL,refreshToken=NULL,idToken=NULL;",
    );
    db.exec('COMMIT;');
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length)
      throw new Error('Restored database contains broken references.');
    const check = db.prepare('PRAGMA integrity_check').get();
    if (check?.integrity_check !== 'ok')
      throw new Error('Restored database failed integrity check.');
    return dumpDatabase(db);
  } finally {
    db.close();
  }
}
