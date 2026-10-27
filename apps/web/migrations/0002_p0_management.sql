-- Search and scope metadata is derived from the immutable, consented snapshot.
ALTER TABLE publications ADD COLUMN audited_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN discovered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN measured_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN engine_version TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN stop_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE publication_intents ADD COLUMN canceled_at INTEGER;

CREATE TRIGGER publication_metadata AFTER INSERT ON publications BEGIN
  UPDATE publications SET
    audited_at=CAST(strftime('%s',json_extract(NEW.report_json,'$.startedAt')) AS INTEGER)*1000,
    discovered_count=json_extract(NEW.report_json,'$.job.discoveredRoutes'),
    measured_count=(SELECT count(*) FROM json_each(NEW.report_json,'$.routes') r WHERE EXISTS(SELECT 1 FROM json_each(r.value,'$.scenarios') s WHERE json_extract(s.value,'$.quality.frameCount')>0)),
    scenario_count=(SELECT count(*) FROM json_each(NEW.report_json,'$.routes') r,json_each(r.value,'$.scenarios') s WHERE json_extract(s.value,'$.quality.frameCount')>0),
    candidate_count=(SELECT count(*) FROM json_each(NEW.report_json,'$.routes') r,json_each(r.value,'$.scenarios') s,json_each(s.value,'$.findings')),
    engine_version=json_extract(NEW.report_json,'$.engineVersion'),
    stop_reason=json_extract(NEW.report_json,'$.job.stopReason')
  WHERE id=NEW.id;
END;
UPDATE publications SET
  audited_at=COALESCE(CAST(strftime('%s',json_extract(report_json,'$.startedAt')) AS INTEGER)*1000,published_at),
  discovered_count=COALESCE(json_extract(report_json,'$.job.discoveredRoutes'),0),
  measured_count=(SELECT count(*) FROM json_each(publications.report_json,'$.routes') r WHERE EXISTS(SELECT 1 FROM json_each(r.value,'$.scenarios') s WHERE json_extract(s.value,'$.quality.frameCount')>0)),
  scenario_count=(SELECT count(*) FROM json_each(publications.report_json,'$.routes') r,json_each(r.value,'$.scenarios') s WHERE json_extract(s.value,'$.quality.frameCount')>0),
  candidate_count=(SELECT count(*) FROM json_each(publications.report_json,'$.routes') r,json_each(r.value,'$.scenarios') s,json_each(s.value,'$.findings')),
  engine_version=COALESCE(json_extract(report_json,'$.engineVersion'),''),
  stop_reason=COALESCE(json_extract(report_json,'$.job.stopReason'),'');
CREATE INDEX public_audit_filter_idx ON publications(visibility,state,audited_at DESC,status);

-- Export this minimal ledger separately from data backups. Restore must replay it
-- before serving traffic; it deliberately contains no identity or report content.
CREATE TABLE erasure_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('account','publication')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('delete','revoke','visibility','rotate-link')),
  revision INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX erasure_time_idx ON erasure_log(created_at,id);
CREATE TRIGGER erasure_no_update BEFORE UPDATE ON erasure_log BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER erasure_no_delete BEFORE DELETE ON erasure_log BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;

-- Erasure also removes derived metadata and free-text moderation context. This
-- runs for API deletion and disaster-recovery replay alike.
CREATE TRIGGER publication_erasure_metadata AFTER UPDATE OF size_bytes ON publications
WHEN OLD.size_bytes>0 AND NEW.size_bytes=0 BEGIN
  UPDATE publications SET report_json='null',audited_at=0,discovered_count=0,measured_count=0,scenario_count=0,candidate_count=0,engine_version='',stop_reason='',moderation_reason=NULL WHERE id=NEW.id;
  UPDATE moderation_events SET reason='[report deleted]' WHERE publication_id=NEW.id;
END;
UPDATE publications SET audited_at=0 WHERE size_bytes=0;

CREATE TRIGGER intent_renew_limit BEFORE UPDATE OF state ON publication_intents
WHEN OLD.state='EXPIRED' AND NEW.state='PENDING' BEGIN
  SELECT CASE WHEN OLD.canceled_at IS NOT NULL THEN RAISE(ABORT,'INTENT_CANCELLED') END;
  SELECT CASE WHEN (SELECT count(*) FROM publication_intents WHERE owner_id=NEW.owner_id AND id!=NEW.id AND state IN ('PENDING','VERIFIED') AND expires_at>=CAST(strftime('%s','now') AS INTEGER)*1000)>=3 THEN RAISE(ABORT,'PENDING_QUOTA') END;
END;
