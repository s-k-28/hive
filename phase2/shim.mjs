// HIVE Phase 2 browser control shim (PROVEN working on darwin arm64, Node 24).
// A tiny authed HTTP server that fronts the agent-browser CLI so the HIVE
// orchestrator edge function can drive a real Chrome over HTTPS. Put a tunnel
// or Caddy in front for TLS and keep SHIM_TOKEN in an InsForge secret.
//
// Run:  SHIM_TOKEN=<token> SHIM_PORT=8787 node phase2/shim.mjs
// Call: POST /act  {"argv":["open","https://example.com"]}  Authorization: Bearer <token>
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const TOKEN = process.env.SHIM_TOKEN || 'dev-token';
const PORT = Number(process.env.SHIM_PORT || 8787);

// Only the browser verbs a research worker needs. No arbitrary subcommands.
const ALLOW = new Set([
  'open', 'goto', 'navigate', 'snapshot', 'click', 'dblclick', 'fill',
  'type', 'press', 'key', 'get', 'screenshot', 'scroll', 'find', 'focus', 'stream',
]);

function run(argv) {
  return new Promise((resolve) => {
    execFile('agent-browser', argv, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const server = createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST' || !req.url.startsWith('/act')) return send(404, { ok: false, error: 'not found' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { ok: false, error: 'unauthorized' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let p;
    try { p = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
    const argv = Array.isArray(p.argv) ? p.argv.map(String) : [];
    if (!argv.length || !ALLOW.has(argv[0])) return send(400, { ok: false, error: 'action not allowed' });
    const result = await run(argv);
    send(result.ok ? 200 : 500, result);
  });
});

server.listen(PORT, () => console.log(`hive browser shim listening on :${PORT}`));
