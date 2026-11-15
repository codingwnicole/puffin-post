-- Link planner ideas created before 0026 to the hidden (hiatus) character they came from,
-- so "Add to cast" restores that row instead of minting a duplicate (the ghost-character bug).
-- Only unambiguous matches: exactly one hiatus character with the same name in the workspace.
UPDATE character_plans
SET source_character_id = (
  SELECT c.id FROM characters c
  WHERE c.workspace_id = character_plans.workspace_id AND c.state = 'hiatus'
    AND lower(trim(c.name)) = lower(trim(character_plans.name))
)
WHERE source_character_id IS NULL
  AND (
    SELECT count(*) FROM characters c
    WHERE c.workspace_id = character_plans.workspace_id AND c.state = 'hiatus'
      AND lower(trim(c.name)) = lower(trim(character_plans.name))
  ) = 1;
