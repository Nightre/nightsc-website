import type { APIRoute } from "astro";

export const prerender = false;

const POST_ID_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,199}$/i;
const MAX_NAME_LENGTH = 40;
const MAX_CONTENT_LENGTH = 2000;

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

	try {
		await database
			.prepare(
				`INSERT INTO comments (id, post_id, author_name, content, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.bind(comment.id, postId, comment.name, comment.content, comment.createdAt)
			.run();
		return Response.json({ code: "success", comment }, { status: 201 });
	} catch (error) {
		console.error("Could not create comment", error);
		return Response.json({ code: "error" }, { status: 500 });
	}
};

export const ALL: APIRoute = () => Response.json({ code: "error" }, { status: 405 });
