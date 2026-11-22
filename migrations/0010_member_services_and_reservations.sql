-- Membership permits service registration, never access to the shared member export.
CREATE VIEW service_creators AS
 SELECT u.id AS user_id FROM users u
 WHERE u.status='active' AND (
  EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id)
  OR (NOT EXISTS(SELECT 1 FROM developers d WHERE d.user_id=u.id AND d.status='inactive')
   AND NOT EXISTS(SELECT 1 FROM common_members m WHERE m.user_id=u.id AND m.status='suspended')
   AND (EXISTS(SELECT 1 FROM developers d WHERE d.user_id=u.id AND d.status='active')
    OR EXISTS(SELECT 1 FROM game_accounts g JOIN default_access_roster def ON def.id=1
     JOIN access_rosters r ON r.id=def.roster_id AND r.status='active'
     WHERE g.user_id=u.id
      AND (EXISTS(SELECT 1 FROM automatic_registrations a WHERE a.user_id=u.id)
       OR EXISTS(SELECT 1 FROM common_members m WHERE m.user_id=u.id AND m.status='approved'))
      AND (
      (r.organization_id IS NULL AND EXISTS(SELECT 1 FROM access_roster_entries e WHERE e.roster_id=r.id AND e.game_uid=g.game_uid AND e.status='active'))
      OR (EXISTS(SELECT 1 FROM member_organizations org WHERE org.id=r.organization_id)
       AND NOT EXISTS(SELECT 1 FROM catalog_state c WHERE c.kind='organization' AND c.entity_id=r.organization_id AND c.deleted_at IS NOT NULL)
       AND EXISTS(SELECT 1 FROM roster_entries e JOIN member_seasons s ON s.id=e.season_id
        WHERE e.organization_id=r.organization_id AND e.game_uid=g.game_uid AND e.realm=g.realm
         AND e.status='active' AND s.status='active'
         AND NOT EXISTS(SELECT 1 FROM catalog_state c WHERE c.kind='season' AND c.entity_id=s.id AND c.deleted_at IS NOT NULL)))
     )))));
DROP VIEW service_managers;
CREATE VIEW service_managers AS
 SELECT o.client_id,o.user_id,'owner' AS role FROM application_owners o JOIN users u ON u.id=o.user_id
 WHERE u.status='active' AND (EXISTS(SELECT 1 FROM auth_operators p WHERE p.user_id=u.id)
  OR (NOT EXISTS(SELECT 1 FROM developers d WHERE d.user_id=u.id AND d.status='inactive')
   AND NOT EXISTS(SELECT 1 FROM common_members m WHERE m.user_id=u.id AND m.status='suspended')))
 UNION ALL
 SELECT a.client_id,a.user_id,'admin' AS role FROM application_administrators a JOIN users u ON u.id=a.user_id
 WHERE u.status='active' AND NOT EXISTS(SELECT 1 FROM common_members m WHERE m.user_id=u.id AND m.status='suspended');

CREATE TABLE permission_reservations (
 id TEXT PRIMARY KEY,
 game_uid TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('developer','manager','superadmin','service_admin')),
 client_id TEXT REFERENCES applications(client_id),
 organization_id TEXT REFERENCES member_organizations(id),
 token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 redeemed_by TEXT REFERENCES users(id),
 redeemed_at INTEGER,
 CHECK((role='service_admin' AND client_id IS NOT NULL AND organization_id IS NULL)
  OR (role='manager' AND organization_id IS NOT NULL AND client_id IS NULL)
  OR (role IN ('developer','superadmin') AND client_id IS NULL AND organization_id IS NULL)),
 CHECK((redeemed_by IS NULL)=(redeemed_at IS NULL))
);
CREATE INDEX permission_reservation_scope ON permission_reservations(client_id,created_at);
