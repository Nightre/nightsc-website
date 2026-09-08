CREATE TABLE IF NOT EXISTS visitor_relay_state (
	kind TEXT PRIMARY KEY CHECK (kind IN ('drawing', 'code')),
	content TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_relay_rate_limits (
	client_key TEXT NOT NULL,
	action TEXT NOT NULL,
	window_started_at INTEGER NOT NULL,
	request_count INTEGER NOT NULL,
	PRIMARY KEY (client_key, action)
);
