CREATE TABLE IF NOT EXISTS comment_rate_limits (
	client_key TEXT PRIMARY KEY,
	window_started_at INTEGER NOT NULL,
	comment_count INTEGER NOT NULL
);
