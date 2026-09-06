CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	post_id TEXT NOT NULL,
	author_name TEXT NOT NULL,
	content TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_post_created_at_idx
	ON comments (post_id, created_at DESC);
