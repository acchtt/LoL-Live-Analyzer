const API_PREVIEW = 'https://reliability-lol-live-analyzer-api.acchtt.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__preview-health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'RiftPulse dashboard PR preview',
        apiPreview: API_PREVIEW,
        updatedAt: new Date().toISOString()
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
