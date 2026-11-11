CREATE TABLE developer_invitations (
 token_hash TEXT PRIMARY KEY,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 redeemed_by TEXT REFERENCES users(id),
 redeemed_at INTEGER
);
