interface Env {
  CONTROL_API: Fetcher;
  CONTROL_TOKEN: string;
}

type StreamTarget = 'youtube' | 'twitch';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ success: true, service: 'vtulog-live', message: 'Worker is running' });
    }

    if (url.pathname !== '/api/target') return new Response('Not Found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body: { target: StreamTarget } | undefined;
    if (request.method === 'POST') {
      try {
        const input: unknown = await request.json();
        if (!input || typeof input !== 'object' || !('target' in input) ||
            (input.target !== 'youtube' && input.target !== 'twitch')) {
          return Response.json({ success: false, error: 'Invalid target' }, { status: 400 });
        }
        body = { target: input.target };
      } catch {
        return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
      }
    }

    try {
      const response = await env.CONTROL_API.fetch('http://127.0.0.1:8765/target', {
        method: request.method,
        headers: {
          Authorization: `Bearer ${env.CONTROL_TOKEN}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      return Response.json(data, {
        status: response.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ success: false, error: 'Control API connection failed' }, { status: 502 });
    }
  },
};
