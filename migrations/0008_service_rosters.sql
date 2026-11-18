-- Share a centrally managed roster or bind a developer-owned independent roster.
CREATE TABLE access_rosters (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 owner_user_id TEXT REFERENCES users(id),
 organization_id TEXT UNIQUE REFERENCES member_organizations(id),
 status TEXT NOT NULL CHECK(status IN ('active','deleted')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK((owner_user_id IS NULL AND organization_id IS NOT NULL) OR (owner_user_id IS NOT NULL AND organization_id IS NULL))
);
CREATE INDEX access_roster_owner ON access_rosters(owner_user_id,status);
CREATE TABLE access_roster_entries (
 id TEXT PRIMARY KEY,
 roster_id TEXT NOT NULL REFERENCES access_rosters(id),
 game_uid TEXT NOT NULL,
 nickname TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','deleted')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(roster_id,game_uid)
);
CREATE TABLE application_rosters (
 client_id TEXT PRIMARY KEY REFERENCES applications(client_id),
 roster_id TEXT NOT NULL REFERENCES access_rosters(id)
);
CREATE TABLE default_access_roster (
 id INTEGER PRIMARY KEY CHECK(id=1),
 roster_id TEXT NOT NULL REFERENCES access_rosters(id)
);
INSERT INTO access_rosters
 SELECT 'shared_'||id,name,NULL,id,'active',1,0,0 FROM member_organizations;
CREATE TRIGGER share_new_organization AFTER INSERT ON member_organizations
BEGIN
 INSERT INTO access_rosters VALUES('shared_'||NEW.id,NEW.name,NULL,NEW.id,'active',1,0,0);
END;
-- Preserve the original three-column insert contract and every legacy policy.
ALTER TABLE common_application_policies RENAME TO legacy_application_policies;
CREATE TABLE common_application_policies (
 client_id TEXT PRIMARY KEY REFERENCES applications(client_id),
 mode TEXT NOT NULL CHECK(mode IN ('approved','season','admin','roster')),
 organization_id TEXT REFERENCES member_organizations(id),
 CHECK(mode<>'season' OR organization_id IS NOT NULL)
);
INSERT INTO common_application_policies SELECT * FROM legacy_application_policies;
DROP TABLE legacy_application_policies;
-- A unique existing service roster is the default; ambiguous installations require an explicit choice.
INSERT INTO default_access_roster
 SELECT 1,'shared_'||MIN(p.organization_id) FROM common_application_policies p JOIN applications a ON a.client_id=p.client_id
 WHERE p.mode='season' AND a.status='active'
 HAVING COUNT(DISTINCT p.organization_id)=1;
