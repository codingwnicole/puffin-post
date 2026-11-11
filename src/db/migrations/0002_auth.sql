ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'shared' CHECK (kind IN ('beta', 'shared'));

CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  intent TEXT NOT NULL CHECK (intent IN ('sign_in', 'accept_invite')),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  invite_id TEXT REFERENCES invites(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK ((intent = 'sign_in' AND invite_id IS NULL) OR (intent = 'accept_invite' AND invite_id IS NOT NULL))
);
CREATE INDEX magic_links_expiry ON magic_links(expires_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user ON sessions(user_id, expires_at);
