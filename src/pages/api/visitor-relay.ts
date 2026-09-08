import type { APIRoute } from 'astro';

export const prerender = false;

const STATE_KINDS = ['drawing', 'code'] as const;
const STATE_LIMITS = {
	drawing: 1_200_000,
	code: 20_000,
} as const;

type StateKind = (typeof STATE_KINDS)[number];
type RuntimeEnv = { COMMENTS_DB?: D1Database };
type StateRow = { kind: StateKind; content: string; updated_at: string };
type RateLimitRow = { window_started_at: number; request_count: number };

function getDatabase(locals: App.Locals) {
	return (locals as unknown as { runtime?: { env?: RuntimeEnv } }).runtime?.env?.COMMENTS_DB;
}

function getClientKey(request: Request) {
	const ip = request.headers.get('CF-Connecting-IP')
		?? request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim()
		?? 'unknown';
	return `ip:${ip}`;
}

function isSameOrigin(request: Request, url: URL) {
	const origin = request.headers.get('origin');
	return !origin || origin === url.origin;
}

function isStateKind(value: unknown): value is StateKind {
	return typeof value === 'string' && STATE_KINDS.includes(value as StateKind);
}

async function isRateLimited(
	database: D1Database,
	request: Request,
	action: string,
	limit: number,
	windowSeconds: number,
) {
	const now = Math.floor(Date.now() / 1000);
	const row = await database
		.prepare(
			`INSERT INTO visitor_relay_rate_limits
				(client_key, action, window_started_at, request_count)
			 VALUES (?, ?, ?, 1)
			 ON CONFLICT(client_key, action) DO UPDATE SET
				window_started_at = CASE
					WHEN visitor_relay_rate_limits.window_started_at <= ? THEN excluded.window_started_at
					ELSE visitor_relay_rate_limits.window_started_at
				END,
				request_count = CASE
					WHEN visitor_relay_rate_limits.window_started_at <= ? THEN 1
					ELSE visitor_relay_rate_limits.request_count + 1
				END
			 RETURNING window_started_at, request_count`,
		)
		.bind(
			getClientKey(request),
			action,
			now,
			now - windowSeconds,
			now - windowSeconds,
		)
		.first<RateLimitRow>();

	return Boolean(row && row.request_count > limit);
}

export const GET: APIRoute = async ({ locals }) => {
	const database = getDatabase(locals);
	if (!database) return Response.json({ code: 'unavailable' }, { status: 503 });

	try {
		const result = await database
			.prepare('SELECT kind, content, updated_at FROM visitor_relay_state')
			.all<StateRow>();
		const state = Object.fromEntries(result.results.map((row) => [row.kind, row.content]));
		return Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		console.error('Could not load visitor relay state', error);
		return Response.json({ code: 'error' }, { status: 500 });
	}
};

export const PUT: APIRoute = async ({ request, locals, url }) => {
	if (!isSameOrigin(request, url)) return Response.json({ code: 'error' }, { status: 403 });
	if (Number(request.headers.get('content-length') ?? 0) > 1_400_000) {
		return Response.json({ code: 'too_large' }, { status: 413 });
	}

	let payload: { kind?: unknown; content?: unknown };
	try {
		payload = await request.json();
	} catch {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}

	if (!isStateKind(payload.kind) || typeof payload.content !== 'string') {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}

	const content = payload.content;
	if (!content.trim() || content.length > STATE_LIMITS[payload.kind]) {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}
	if (payload.kind === 'drawing' && !/^data:image\/(?:png|jpeg|webp);base64,/i.test(content)) {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}

	const database = getDatabase(locals);
	if (!database) return Response.json({ code: 'unavailable' }, { status: 503 });

	try {
		if (await isRateLimited(database, request, `save:${payload.kind}`, 12, 60)) {
			return Response.json({ code: 'rate_limited' }, { status: 429 });
		}

		const updatedAt = new Date().toISOString();
		await database
			.prepare(
				`INSERT INTO visitor_relay_state (kind, content, updated_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(kind) DO UPDATE SET
					content = excluded.content,
					updated_at = excluded.updated_at`,
			)
			.bind(payload.kind, content, updatedAt)
			.run();

		return Response.json({ code: 'success', updatedAt });
	} catch (error) {
		console.error('Could not save visitor relay state', error);
		return Response.json({ code: 'error' }, { status: 500 });
	}
};

export const ALL: APIRoute = () => Response.json({ code: 'error' }, { status: 405 });
