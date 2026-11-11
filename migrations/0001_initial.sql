PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  is_guild_member INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'inactive',
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, guild_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS applications (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  client_state TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires_at ON oauth_requests(expires_at);

CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires_at ON auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id ON access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at ON access_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  client_id TEXT,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_created_at ON auth_events(created_at);

CREATE TABLE auth_operators(user_id TEXT PRIMARY KEY REFERENCES users(id),role TEXT NOT NULL,created_at INTEGER NOT NULL,created_by_user_id TEXT REFERENCES users(id));
CREATE TABLE user_reauthentication(user_id TEXT PRIMARY KEY REFERENCES users(id),requested_at INTEGER NOT NULL,requested_by TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL);
PRAGMA foreign_keys = ON;
CREATE TABLE common_members (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('approved','suspended')),
 approved_at INTEGER NOT NULL, approved_by TEXT REFERENCES users(id)
);
CREATE TABLE game_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 realm TEXT NOT NULL, game_uid TEXT NOT NULL, nickname TEXT NOT NULL,
 UNIQUE(realm,game_uid)
);
CREATE TABLE member_applications (
 user_id TEXT PRIMARY KEY REFERENCES users(id), realm TEXT NOT NULL, game_uid TEXT NOT NULL,
 nickname TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 requested_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id)
);
CREATE INDEX member_application_uid ON member_applications(realm,game_uid);
CREATE TABLE member_organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE member_seasons (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','active','archived'))
);
CREATE UNIQUE INDEX one_active_member_season ON member_seasons(status) WHERE status='active';
CREATE TABLE season_memberships (
 user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES member_seasons(id),
 organization_id TEXT NOT NULL REFERENCES member_organizations(id),
 status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 updated_at INTEGER NOT NULL, updated_by TEXT REFERENCES users(id),
 PRIMARY KEY(user_id,season_id)
);
CREATE TABLE common_application_policies (
 client_id TEXT PRIMARY KEY REFERENCES applications(client_id),
 mode TEXT NOT NULL CHECK(mode IN ('approved','season','admin')),
 organization_id TEXT REFERENCES member_organizations(id),
 CHECK(mode <> 'season' OR organization_id IS NOT NULL)
);
ALTER TABLE auth_codes ADD COLUMN session_expires_at INTEGER;
ALTER TABLE auth_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE member_approval_receipts (
 request_user_id TEXT PRIMARY KEY REFERENCES users(id),
 target_user_id TEXT NOT NULL REFERENCES users(id),
 approved_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_firebase_identity_per_account ON auth_identities(user_id,provider) WHERE provider LIKE 'firebase:%';

CREATE TABLE developers(user_id TEXT PRIMARY KEY REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('active','inactive')));
CREATE TABLE application_owners(client_id TEXT PRIMARY KEY REFERENCES applications(client_id),user_id TEXT NOT NULL REFERENCES users(id));
