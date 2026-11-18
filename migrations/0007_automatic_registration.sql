-- Additive marker: existing IDs, approvals, restrictions and roster names stay intact.
-- Presence means membership follows the live roster; absence retains legacy approvals.
CREATE TABLE automatic_registrations (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 nickname TEXT NOT NULL,
 registered_at INTEGER NOT NULL
);
