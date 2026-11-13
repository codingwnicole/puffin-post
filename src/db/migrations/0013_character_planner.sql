CREATE TABLE character_plans (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  faceclaim TEXT,
  notes TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'idea' CHECK (state IN ('idea','developing','ready')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX character_plans_workspace_updated ON character_plans(workspace_id, updated_at DESC);

CREATE TABLE character_plan_resources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES character_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX character_plan_resources_plan_created ON character_plan_resources(workspace_id, plan_id, created_at);
