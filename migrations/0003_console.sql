CREATE TABLE member_managers (
 user_id TEXT NOT NULL REFERENCES users(id),
 organization_id TEXT NOT NULL REFERENCES member_organizations(id),
 granted_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,organization_id)
);
CREATE TABLE login_branding (
 client_id TEXT PRIMARY KEY REFERENCES applications(client_id),
 title TEXT NOT NULL, description TEXT NOT NULL, logo_url TEXT NOT NULL,
 accent TEXT NOT NULL, theme TEXT NOT NULL CHECK(theme IN ('light','dark')),
 updated_at INTEGER NOT NULL
);
CREATE TRIGGER retain_last_operator BEFORE DELETE ON auth_operators
WHEN (SELECT COUNT(*) FROM auth_operators)=1
BEGIN
 SELECT RAISE(ABORT,'LAST_OPERATOR');
END;
