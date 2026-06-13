# HIVE Phase 2 Runbook: agents driving a real browser, live

This is the stretch feature: a HIVE worker drives a real Chrome via Vercel Labs
`agent-browser`, and the CenterStage `browser` slot streams the live viewport.
Everything below was proven working on this machine (darwin arm64, Node 24,
Chrome already installed). Phase 1 (the workspace) never imports any of this,
so a broken stream cannot affect the main product.

## What is proven

- PROVEN LIVE (2026-06-13): the deployed InsForge orchestrator drove a real
  Chrome through a cloudflared tunnel. A research mission's workers opened
  `https://vercel.com/pricing`, extracted real prices ($20/member/month, 1TB
  bandwidth, 3 concurrent builds), and folded them into their output; the critic
  accepted and the risk gate fired, all on the live backend. Proof image:
  `docs/qa/phase2-live-vercel.png`. The feature was then disarmed (browser
  secrets removed, orchestrator redeployed) so the public site stays
  self-contained until we deliberately re-arm for the demo.
- `npm i -g agent-browser` installs the native CLI. It auto-detects the system
  Chrome, so no separate Chrome download is needed.
- `agent-browser open <url>`, `snapshot`, `get text <sel>`, `screenshot` all work.
- Every session auto-starts a viewport WebSocket on a session port
  (for example `ws://127.0.0.1:65025`). `GET /api/sessions` on the dashboard
  returns `[{"engine":"chrome","port":65025,"session":"default"}]`.
- The viewport stream pushes JSON messages of type `status`, `tabs`, and
  `frame`. A `frame` message carries a base64 JPEG of the live viewport
  (observed ~20 KB per frame).
- The control shim (`phase2/shim.mjs`) enforces a bearer token (401 without it)
  and runs browser verbs on demand. This is the path the orchestrator calls.

## Go-live steps (demo day)

1. Start the browser + session:
   ```
   agent-browser open about:blank
   agent-browser stream status        # note the session port, e.g. 65025
   agent-browser dashboard start      # serves the stream proxy on :4848
   ```
2. Start the authed control shim:
   ```
   SHIM_TOKEN=$(openssl rand -hex 24) SHIM_PORT=8787 node phase2/shim.mjs
   ```
   Keep that token. You will store it as an InsForge secret below.
3. Expose both surfaces over HTTPS/WSS with a tunnel (the HIVE site is https, so
   plain ws is blocked by the browser; the stream must be wss):
   ```
   cloudflared tunnel --url http://localhost:8787     # control  -> https URL
   cloudflared tunnel --url http://localhost:4848     # stream    -> wss .../api/session/<port>/stream
   ```
   (A single small VM with Caddy works too; the tunnel is the fastest path.)
4. Store the control endpoint and token as InsForge secrets so the orchestrator
   can reach the shim:
   ```
   npx @insforge/cli secrets add BROWSER_DAEMON_URL  https://<control-tunnel>/act
   npx @insforge/cli secrets add BROWSER_DAEMON_TOKEN <the SHIM_TOKEN>
   npx @insforge/cli secrets add HIVE_BROWSER_ENABLED 1
   ```
5. Point the frontend `browser` stage at the stream tunnel:
   `wss://<stream-tunnel>/api/session/<port>/stream` (see
   `phase2/BrowserStage.reference.tsx`).
6. Launch a mission whose plan includes a research task. The worker calls the
   shim (open, snapshot, get text), the panel shows the live browser, and the
   extracted text becomes a worker artifact in the mission.

## Control protocol (orchestrator -> shim)

```
POST <BROWSER_DAEMON_URL>
Authorization: Bearer <BROWSER_DAEMON_TOKEN>
Content-Type: application/json

{"argv": ["open", "https://competitor.com/pricing"]}
{"argv": ["snapshot"]}
{"argv": ["get", "text", "h1"]}
```
Response: `{"ok":true,"code":0,"stdout":"...","stderr":""}`. This is an external
HTTPS call from the edge function, so it is NOT subject to the InsForge
function-to-function 508 rule.

## Cut line (so Phase 1 always ships)

1. Drop human take-over first; ship view-only streaming (still a strong demo).
2. If the stream fights you, drop it and poll `{"argv":["screenshot"]}` to show
   still images (HTTPS only, no wss).
3. Drop Phase 2 entirely. Keep the `browser` stage behind a feature flag so a
   broken stream never reaches the main UI.
