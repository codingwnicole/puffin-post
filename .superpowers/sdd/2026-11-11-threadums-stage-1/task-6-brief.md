# Task 6 — Tumblr connection safety

Implement the bounded Tumblr connection layer: strict post-URL parsing, OAuth 1.0a request/callback routes with one-use state, AES-GCM encrypted access-token persistence, and a character-blog ownership check before starter creation. Tests use mocked network responses only. No deployment, live OAuth, or credential use is in scope.

Acceptance: OAuth state cannot replay; D1 does not contain plaintext access tokens; a Tumblr post URL/blog that does not match the selected character blog is rejected; a canonical blog may be attached to more than one character.
