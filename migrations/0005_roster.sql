CREATE TABLE roster_entries (
 id TEXT PRIMARY KEY,
 realm TEXT NOT NULL,
 game_uid TEXT NOT NULL,
 nickname TEXT NOT NULL,
 season_id TEXT NOT NULL REFERENCES member_seasons(id),
 organization_id TEXT NOT NULL REFERENCES member_organizations(id),
 status TEXT NOT NULL CHECK(status IN ('active','deleted')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 updated_at INTEGER NOT NULL,
 updated_by TEXT REFERENCES users(id),
 UNIQUE(realm,game_uid,season_id)
);
CREATE INDEX roster_scope ON roster_entries(season_id,organization_id,status);

INSERT INTO roster_entries
 SELECT 'rst_'||lower(hex(randomblob(16))),g.realm,g.game_uid,g.nickname,
 s.season_id,s.organization_id,CASE WHEN s.status='active' THEN 'active' ELSE 'deleted' END,
 1,s.updated_at,s.updated_by FROM season_memberships s JOIN game_accounts g ON g.user_id=s.user_id;

-- Existing approval, assignment and season-copy paths keep the roster in sync.
CREATE TRIGGER roster_after_membership_insert AFTER INSERT ON season_memberships
BEGIN
 INSERT INTO roster_entries(id,realm,game_uid,nickname,season_id,organization_id,status,revision,updated_at,updated_by)
 SELECT 'rst_'||lower(hex(randomblob(16))),g.realm,g.game_uid,g.nickname,
 NEW.season_id,NEW.organization_id,CASE WHEN NEW.status='active' THEN 'active' ELSE 'deleted' END,
 1,NEW.updated_at,NEW.updated_by FROM game_accounts g WHERE g.user_id=NEW.user_id
 ON CONFLICT(realm,game_uid,season_id) DO UPDATE SET
 nickname=excluded.nickname,organization_id=excluded.organization_id,status=excluded.status,
 revision=roster_entries.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
END;
CREATE TRIGGER roster_after_membership_update AFTER UPDATE ON season_memberships
BEGIN
 INSERT INTO roster_entries(id,realm,game_uid,nickname,season_id,organization_id,status,revision,updated_at,updated_by)
 SELECT 'rst_'||lower(hex(randomblob(16))),g.realm,g.game_uid,g.nickname,
 NEW.season_id,NEW.organization_id,CASE WHEN NEW.status='active' THEN 'active' ELSE 'deleted' END,
 1,NEW.updated_at,NEW.updated_by FROM game_accounts g WHERE g.user_id=NEW.user_id
 ON CONFLICT(realm,game_uid,season_id) DO UPDATE SET
 nickname=excluded.nickname,organization_id=excluded.organization_id,status=excluded.status,
 revision=roster_entries.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
END;
