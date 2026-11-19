-- Trading card profile for a character (theme and card text as JSON, validated by the API).
-- The card portrait reuses the character icon.
ALTER TABLE characters ADD COLUMN card_json TEXT;
