ALTER TABLE character_blogs ADD COLUMN character_tag TEXT;

-- A whole-blog rule cannot share a blog with any other character. Tagged rules can.
CREATE UNIQUE INDEX character_blogs_one_whole_blog_rule
  ON character_blogs(workspace_id, tumblr_connection_id, blog_identifier)
  WHERE character_tag IS NULL;
CREATE UNIQUE INDEX character_blogs_unique_tag_rule
  ON character_blogs(workspace_id, tumblr_connection_id, blog_identifier, character_tag)
  WHERE character_tag IS NOT NULL;
