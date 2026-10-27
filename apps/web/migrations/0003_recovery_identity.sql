-- A durable identity distinguishes independent local/self-hosted databases.
-- It travels with a backup; never accept an erasure ledger from another database.
CREATE TABLE operations_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO operations_meta(key,value) VALUES('database-instance',lower(hex(randomblob(16))));
