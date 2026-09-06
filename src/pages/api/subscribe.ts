import type { APIRoute } from 'astro';

export const prerender = false;

const BUTTONDOWN_URL = 'https://api.buttondown.com/v1/subscribers';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		return Response.json({ code: 'error' }, { status: 403 });
	}

	let payload: { email?: unknown; website?: unknown };
	try {
		payload = await request.json();
	} catch {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}

	if (typeof payload.website === 'string' && payload.website.trim()) {
		return Response.json({ code: 'success' });
	}

	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
		return Response.json({ code: 'invalid' }, { status: 400 });
	}

	const runtimeEnv = (locals as unknown as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
	const apiKey = runtimeEnv?.BUTTONDOWN_API_KEY ?? import.meta.env.BUTTONDOWN_API_KEY;
	if (!apiKey) {
		console.error('BUTTONDOWN_API_KEY is not configured');
		return Response.json({ code: 'error' }, { status: 503 });
	}

	try {
		const response = await fetch(BUTTONDOWN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Token ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				email_address: email,
				tags: ['newsletter', 'welcome'],
			}),
		});

		if (response.ok) {
			return Response.json({ code: 'success' });
		}

		const upstreamMessage = (await response.text()).toLowerCase();
		if ([400, 409, 422].includes(response.status) && (upstreamMessage.includes('already') || upstreamMessage.includes('exist'))) {
			return Response.json({ code: 'exists' });
		}

		console.error(`Buttondown subscription failed with status ${response.status}`);
		return Response.json({ code: 'error' }, { status: 502 });
	} catch (error) {
		console.error('Buttondown subscription request failed', error);
		return Response.json({ code: 'error' }, { status: 502 });
	}
};

export const ALL: APIRoute = () => Response.json({ code: 'error' }, { status: 405 });
