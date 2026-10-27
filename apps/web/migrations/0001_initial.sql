-- Better Auth core schema; dates are UTC milliseconds, matching Drizzle timestamp_ms.
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
CREATE INDEX session_user_idx ON session(userId);
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX account_user_idx ON account(userId);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE publication_intents (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id), idempotency_key TEXT NOT NULL,
  content_hash TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','UNLISTED','PUBLIC')),
  report_json TEXT, size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 1048576),
  origin TEXT NOT NULL, status TEXT NOT NULL, route_count INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','VERIFIED','CONSUMED','EXPIRED')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, verified_until INTEGER,
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX intent_owner_expiry_idx ON publication_intents(owner_id, expires_at);
CREATE TABLE challenges (
  id TEXT PRIMARY KEY, action TEXT NOT NULL CHECK(action IN ('auth','publish','abuse')),
  owner_id TEXT, intent_id TEXT, cdata TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, verify_key TEXT NOT NULL
);
CREATE INDEX challenge_expiry_idx ON challenges(expires_at);
CREATE TABLE account_usage (owner_id TEXT PRIMARY KEY REFERENCES user(id), size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0));
CREATE TABLE daily_usage (owner_id TEXT NOT NULL REFERENCES user(id), day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner_id,day));
CREATE TABLE publications (
  id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE REFERENCES publication_intents(id),
  owner_id TEXT NOT NULL REFERENCES user(id), author_name TEXT NOT NULL, content_hash TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','UNLISTED','PUBLIC')),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','REVOKED','HIDDEN_BY_MODERATION')),
  revision INTEGER NOT NULL DEFAULT 1, report_json TEXT NOT NULL,
  origin TEXT NOT NULL, status TEXT NOT NULL, route_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL, token_hash TEXT NOT NULL, share_version INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER NOT NULL, revoked_at INTEGER, moderation_reason TEXT
);
CREATE INDEX public_index_idx ON publications(visibility,state,published_at DESC,id DESC);
CREATE INDEX public_origin_idx ON publications(visibility,state,origin,published_at DESC);
CREATE INDEX publication_owner_idx ON publications(owner_id,published_at DESC);

-- This single insert is the transaction boundary: concurrent requests cannot overspend
-- a grant or account quota. The AFTER trigger runs in the same SQLite/D1 transaction.
CREATE TRIGGER publication_guard BEFORE INSERT ON publications BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_intents i WHERE i.id=NEW.intent_id AND i.owner_id=NEW.owner_id
      AND i.state='VERIFIED' AND i.verified_until >= NEW.published_at
      AND i.expires_at >= NEW.published_at AND i.content_hash=NEW.content_hash
      AND i.visibility=NEW.visibility AND i.report_json=NEW.report_json AND i.size_bytes=NEW.size_bytes
  ) THEN RAISE(ABORT,'GRANT_INVALID') END;
  SELECT CASE WHEN COALESCE((SELECT count FROM daily_usage WHERE owner_id=NEW.owner_id AND day=date(NEW.published_at/1000,'unixepoch')),0)>=10 THEN RAISE(ABORT,'DAILY_QUOTA') END;
  SELECT CASE WHEN COALESCE((SELECT size_bytes FROM account_usage WHERE owner_id=NEW.owner_id),0)+NEW.size_bytes>26214400 THEN RAISE(ABORT,'STORAGE_QUOTA') END;
END;
CREATE TRIGGER publication_account AFTER INSERT ON publications BEGIN
  INSERT INTO account_usage(owner_id,size_bytes) VALUES(NEW.owner_id,NEW.size_bytes) ON CONFLICT(owner_id) DO UPDATE SET size_bytes=size_bytes+NEW.size_bytes;
  INSERT INTO daily_usage(owner_id,day,count) VALUES(NEW.owner_id,date(NEW.published_at/1000,'unixepoch'),1) ON CONFLICT(owner_id,day) DO UPDATE SET count=count+1;
  UPDATE publication_intents SET state='CONSUMED',report_json=NULL WHERE id=NEW.intent_id;
END;
CREATE TRIGGER intent_pending_limit BEFORE INSERT ON publication_intents BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM publication_intents WHERE owner_id=NEW.owner_id AND state IN ('PENDING','VERIFIED') AND expires_at>=NEW.created_at)>=3 THEN RAISE(ABORT,'PENDING_QUOTA') END;
END;

CREATE TABLE abuse_reports (
  id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id),
  reporter_id TEXT NOT NULL REFERENCES user(id), category TEXT NOT NULL,
  description TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'OPEN', created_at INTEGER NOT NULL,
  UNIQUE(publication_id,reporter_id)
);
CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id), moderator_id TEXT NOT NULL REFERENCES user(id),
  action TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
-- Keep only an ownership/idempotency tombstone after an explicit owner deletion.
CREATE TRIGGER publication_erased AFTER UPDATE OF size_bytes ON publications
WHEN OLD.size_bytes>0 AND NEW.size_bytes=0 BEGIN
  UPDATE account_usage SET size_bytes=size_bytes-OLD.size_bytes WHERE owner_id=NEW.owner_id;
  UPDATE publication_intents SET report_json=NULL,origin='https://deleted.invalid',status='ERROR',route_count=0 WHERE id=NEW.intent_id;
  UPDATE abuse_reports SET description='[report deleted]',state='CLOSED' WHERE publication_id=NEW.id;
END;
