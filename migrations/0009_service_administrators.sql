CREATE TABLE application_administrators (
 client_id TEXT NOT NULL REFERENCES applications(client_id),
 user_id TEXT NOT NULL REFERENCES users(id),
 granted_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(client_id,user_id)
);
CREATE INDEX application_administrator_user ON application_administrators(user_id,client_id);
CREATE TABLE service_roster_grants (
 client_id TEXT NOT NULL REFERENCES applications(client_id),
 roster_id TEXT NOT NULL REFERENCES access_rosters(id),
 granted_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(client_id,roster_id)
);
CREATE TRIGGER clear_service_roster_grant_after_rebind AFTER UPDATE OF roster_id ON application_rosters
WHEN OLD.roster_id<>NEW.roster_id BEGIN
 DELETE FROM service_roster_grants WHERE client_id=OLD.client_id;
END;
CREATE TRIGGER clear_service_roster_grant_after_unbind AFTER DELETE ON application_rosters BEGIN
 DELETE FROM service_roster_grants WHERE client_id=OLD.client_id;
END;
-- Existing ownership and developer revocation retain their original meaning.
CREATE VIEW service_managers AS
 SELECT o.client_id,o.user_id,'owner' AS role FROM application_owners o JOIN users u ON u.id=o.user_id
 WHERE u.status='active' AND (EXISTS(SELECT 1 FROM developers d WHERE d.user_id=u.id AND d.status='active')
 OR EXISTS(SELECT 1 FROM auth_operators p WHERE p.user_id=u.id))
 UNION ALL
 SELECT a.client_id,a.user_id,'admin' AS role FROM application_administrators a JOIN users u ON u.id=a.user_id WHERE u.status='active';
INSERT INTO application_rosters(client_id,roster_id)
 SELECT p.client_id,r.id FROM common_application_policies p JOIN access_rosters r ON r.organization_id=p.organization_id
 WHERE p.mode='season' AND NOT EXISTS(SELECT 1 FROM application_rosters b WHERE b.client_id=p.client_id);
