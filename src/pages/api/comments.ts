import type { APIRoute } from "astro";

export const prerender = false;

const POST_ID_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,199}$/i;
const MAX_NAME_LENGTH = 40;
const MAX_CONTENT_LENGTH = 2000;
const COMMENT_RATE_LIMIT_WINDOW_SECONDS = 3 * 60;
const COMMENT_RATE_LIMIT_COUNT = 2;

type RuntimeEnv = {
	COMMENTS_DB?: D1Database;
};

type CommentRow = {
	id: string;
	post_id: string;
	author_name: string;
	content: string;
	created_at: string;
};

type RateLimitRow = {
	window_started_at: number;
	comment_count: number;
};

function getDatabase(locals: App.Locals) {
	return (locals as unknown as { runtime?: { env?: RuntimeEnv } }).runtime?.env?.COMMENTS_DB;
}

function toPublicComment(row: CommentRow) {
	return {
		id: row.id,
		name: row.author_name,
		content: row.content,
		createdAt: row.created_at,
	};
}

function getClientKey(request: Request) {
	const ip =
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
		"unknown";
	return `ip:${ip}`;
}

export const GET: APIRoute = async ({ url, locals }) => {
	const postId = url.searchParams.get("postId")?.trim() ?? "";
	if (!POST_ID_PATTERN.test(postId)) {
		return Response.json({ code: "invalid" }, { status: 400 });
	}

	const database = getDatabase(locals);
	if (!database) {
		console.error("COMMENTS_DB is not configured");
		return Response.json({ code: "unavailable" }, { status: 503 });
	}

	try {
		const result = await database
			.prepare(
				`SELECT id, post_id, author_name, content, created_at
				 FROM comments
				 WHERE post_id = ?
				 ORDER BY created_at DESC
				 LIMIT 100`,
			)
			.bind(postId)
			.all<CommentRow>();

		return Response.json(
			{ comments: result.results.map(toPublicComment) },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		console.error("Could not load comments", error);
		return Response.json({ code: "error" }, { status: 500 });
	}
};

export const POST: APIRoute = async ({ request, url, locals }) => {
	const origin = request.headers.get("origin");
	if (origin && origin !== url.origin) {
		return Response.json({ code: "error" }, { status: 403 });
	}

	let payload: { postId?: unknown; name?: unknown; content?: unknown; website?: unknown };
	try {
		payload = await request.json();
	} catch {
		return Response.json({ code: "invalid" }, { status: 400 });
	}

	if (typeof payload.website === "string" && payload.website.trim()) {
		return Response.json({ code: "success" });
	}

	const postId = typeof payload.postId === "string" ? payload.postId.trim() : "";
	const name = typeof payload.name === "string" ? payload.name.trim() : "";
	const content = typeof payload.content === "string" ? payload.content.trim() : "";
	if (
		!POST_ID_PATTERN.test(postId) ||
		!name ||
		name.length > MAX_NAME_LENGTH ||
		!content ||
		content.length > MAX_CONTENT_LENGTH
	) {
		return Response.json({ code: "invalid" }, { status: 400 });
	}

	const database = getDatabase(locals);
	if (!database) {
		console.error("COMMENTS_DB is not configured");
		return Response.json({ code: "unavailable" }, { status: 503 });
	}

	const comment = {
		id: crypto.randomUUID(),
		name,
		content,
		createdAt: new Date().toISOString(),
	};
	const now = Math.floor(Date.now() / 1000);
	const clientKey = getClientKey(request);
	const rateLimit = await database
		.prepare(
			`SELECT window_started_at, comment_count
			 FROM comment_rate_limits
			 WHERE client_key = ?`,
		)
		.bind(clientKey)
		.first<RateLimitRow>();
	const windowIsActive =
		rateLimit && now - rateLimit.window_started_at < COMMENT_RATE_LIMIT_WINDOW_SECONDS;
	if (
		windowIsActive &&
		rateLimit.comment_count >= COMMENT_RATE_LIMIT_COUNT
	) {
		const retryAfter = Math.max(
			1,
			COMMENT_RATE_LIMIT_WINDOW_SECONDS - (now - rateLimit.window_started_at),
		);
		return Response.json(
			{ code: "rate_limited", retryAfter },
			{ status: 429, headers: { "Retry-After": String(retryAfter) } },
		);
	}

	try {
		const [commentResult] = await database.batch([
			database
				.prepare(
					`INSERT INTO comments (id, post_id, author_name, content, created_at)
					 SELECT ?, ?, ?, ?, ?
					 WHERE NOT EXISTS (
						 SELECT 1 FROM comment_rate_limits
						 WHERE client_key = ?
						 AND window_started_at > ?
						 AND comment_count >= ?
					 )`,
				)
				.bind(
					comment.id,
					postId,
					comment.name,
					comment.content,
					comment.createdAt,
					clientKey,
					now - COMMENT_RATE_LIMIT_WINDOW_SECONDS,
					COMMENT_RATE_LIMIT_COUNT,
				),
			database
				.prepare(
					`INSERT INTO comment_rate_limits (client_key, window_started_at, comment_count)
					 SELECT ?, ?, 1
					 WHERE EXISTS (SELECT 1 FROM comments WHERE id = ?)
					 ON CONFLICT(client_key) DO UPDATE SET
						window_started_at = CASE
							WHEN comment_rate_limits.window_started_at <= ? THEN excluded.window_started_at
							ELSE comment_rate_limits.window_started_at
						END,
						comment_count = CASE
							WHEN comment_rate_limits.window_started_at <= ? THEN 1
							ELSE comment_rate_limits.comment_count + 1
						END`,
				)
				.bind(
					clientKey,
					now,
					comment.id,
					now - COMMENT_RATE_LIMIT_WINDOW_SECONDS,
					now - COMMENT_RATE_LIMIT_WINDOW_SECONDS,
				),
		]);
		if (commentResult.meta.changes === 0) {
			return Response.json(
				{ code: "rate_limited" },
				{ status: 429, headers: { "Retry-After": String(COMMENT_RATE_LIMIT_WINDOW_SECONDS) } },
			);
		}
		return Response.json({ code: "success", comment }, { status: 201 });
	} catch (error) {
		console.error("Could not create comment", error);
		return Response.json({ code: "error" }, { status: 500 });
	}
};

export const ALL: APIRoute = () => Response.json({ code: "error" }, { status: 405 });
