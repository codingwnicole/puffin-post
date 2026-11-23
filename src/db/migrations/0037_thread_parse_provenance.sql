ALTER TABLE starters ADD COLUMN title_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE starters ADD COLUMN title_confidence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE starters ADD COLUMN title_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE starters ADD COLUMN title_manual_override_at TEXT;

ALTER TABLE starters ADD COLUMN description_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE starters ADD COLUMN description_confidence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE starters ADD COLUMN description_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE starters ADD COLUMN description_manual_override_at TEXT;

ALTER TABLE starters ADD COLUMN premise_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE starters ADD COLUMN premise_confidence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE starters ADD COLUMN premise_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE starters ADD COLUMN premise_manual_override_at TEXT;

ALTER TABLE reply_branches ADD COLUMN partner_muses_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(partner_muses_json));
ALTER TABLE reply_branches ADD COLUMN partner_muses_source TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE reply_branches ADD COLUMN partner_muses_confidence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reply_branches ADD COLUMN partner_muses_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE reply_branches ADD COLUMN partner_muses_manual_override_at TEXT;
ALTER TABLE reply_branches ADD COLUMN user_recap TEXT NOT NULL DEFAULT '';
ALTER TABLE reply_branches ADD COLUMN latest_reply_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE reply_branches ADD COLUMN latest_reply_confidence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE reply_branches ADD COLUMN latest_reply_evidence TEXT NOT NULL DEFAULT '';

-- Legacy values have no recorded origin. Protect them instead of guessing which
-- existing text came from a writer and which came from the old parser.
UPDATE starters SET title_manual_override_at = created_at WHERE trim(title) <> '';
UPDATE starters SET description_manual_override_at = created_at WHERE trim(description) <> '';
UPDATE starters SET premise_manual_override_at = created_at WHERE trim(premise) <> '';
UPDATE reply_branches SET latest_reply_source = CASE WHEN trim(COALESCE(latest_reply_excerpt,'')) = '' THEN 'unresolved' ELSE 'legacy' END;
