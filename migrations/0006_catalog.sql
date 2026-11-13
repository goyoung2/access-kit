CREATE TABLE catalog_state (
 kind TEXT NOT NULL CHECK(kind IN ('season','organization')),
 entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 deleted_at INTEGER,
 PRIMARY KEY(kind,entity_id)
);
INSERT INTO catalog_state SELECT 'season',id,1,NULL FROM member_seasons;
INSERT INTO catalog_state SELECT 'organization',id,1,NULL FROM member_organizations;
CREATE TRIGGER catalog_season_insert AFTER INSERT ON member_seasons
BEGIN
 INSERT INTO catalog_state VALUES('season',NEW.id,1,NULL);
END;
CREATE TRIGGER catalog_organization_insert AFTER INSERT ON member_organizations
BEGIN
 INSERT INTO catalog_state VALUES('organization',NEW.id,1,NULL);
END;
CREATE TRIGGER catalog_season_update AFTER UPDATE ON member_seasons
BEGIN
 UPDATE catalog_state SET revision=revision+1 WHERE kind='season' AND entity_id=NEW.id;
END;
CREATE TRIGGER catalog_organization_update AFTER UPDATE ON member_organizations
BEGIN
 UPDATE catalog_state SET revision=revision+1 WHERE kind='organization' AND entity_id=NEW.id;
END;
