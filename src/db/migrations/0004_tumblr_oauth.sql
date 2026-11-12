CREATE TABLE tumblr_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  request_token_encrypted TEXT NOT NULL,
  request_secret_encrypted TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX tumblr_oauth_states_expiry ON tumblr_oauth_states(expires_at);
