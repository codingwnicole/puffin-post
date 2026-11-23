-- Optional icon per roadmap item; the API validates the name against the app's roadmap icon set.
ALTER TABLE site_roadmap_items ADD COLUMN icon TEXT;
