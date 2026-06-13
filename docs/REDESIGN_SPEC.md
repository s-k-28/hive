# HIVE UI Redesign Spec: Cursor-style Agent Workspace

Status: authoritative build spec for the second LLM. Frontend-only. The live InsForge backend is finished and must not be touched.

## 1. Overview

Replace the current UI (the floating orb hero and the 2D mission board) with a "Cursor-style" multi-panel agent IDE, modeled on the Vercel Labs `agent-browser` dashboard. Same product, "a live control tower for AI agents" (delegate a goal, watch a transparent agent team work, stop and steer in real time), presented as a credible, professional workspace instead of a tech demo.

Reference repo (clone and study `packages/dashboard`):

```
git clone --depth 1 https://github.com/vercel-labs/agent-browser.git /tmp/agent-browser
```

Key reference files: `packages/dashboard/src/app/page.tsx` (the shell), `src/app/globals.css` (theme tokens), `src/components/ui/*` (shadcn primitives), `src/lib/utils.ts`, `src/hooks/use-media-query.ts`.

Phasing:
- Phase 1: the Cursor workspace on the existing live swarm. Ships safe.
- Phase 2 (stretch): one worker drives a real Chrome via agent-browser, streamed into the center panel. Owned by the planner, not the second LLM. See section 9.

## 2. Ground Rules (non-negotiable)

- NO EM-DASHES anywhere: not in code, comments, UI copy, or commit messages. Use commas, colons, parentheses, or hyphens.
- Production-grade only. No placeholder text, no dead controls, no "vibe-coded" feel.
- Work on a branch `redesign/cursor-workspace`. Open a PR. Pull latest `main` first.
- The 40 existing tests MUST stay green: 31 in `src/state/swarm.test.ts`, 9 in `src/state/simulation.test.ts`, both run in a node env via `vitest.config.ts`. Do not change `vitest.config.ts`.
- DO NOT EDIT (test-pinned and/or own the live realtime wiring): `src/state/swarm.ts`, `src/state/simulation.ts`, `src/lib/types.ts`, `src/lib/insforge.ts`, `src/lib/mission.ts`, and any `*.test.ts`. Put all new read logic in a NEW file `src/state/selectors.ts`.
- DO NOT add new realtime subscriptions in components. All socket wiring stays inside `lib/mission.ts`. Components call existing exported functions only.
- Keep `src/index.css` design tokens and the `.glass` class.

## 3. Live Backend Facts (do not touch, for context only)

- Hosted site: https://nmf6vbv4.insforge.site
- InsForge project "Hive", app key `nmf6vbv4`, region us-east. Backend host `https://nmf6vbv4.us-east.insforge.app`, functions host `https://nmf6vbv4.functions.insforge.app`.
- The orchestrator is ONE merged edge function (`functions/orchestrator.ts`) that runs all roles inline. InsForge blocks function-to-function calls (HTTP 508), so there is no inter-function dispatch.
- The frontend is driven by InsForge realtime: an append-only events table publishes `event_created`, `lib/mission.ts` maps each record and calls `applyEvent` on the zustand store.

## 4. Stack to add (stay on Vite + React 19, do NOT switch to Next)

Runtime deps (versions from the dashboard):

```
npm i class-variance-authority@^0.7.1 clsx@^2.1.1 tailwind-merge@^3.5.0 \
  lucide-react@^1.7.0 cmdk@^1.1.1 react-resizable-panels@^4.7.6 \
  radix-ui@^1.4.3 @radix-ui/react-popover@^1.1.15
```

Dev deps (Tailwind v4 via the Vite plugin, simplest path):

```
npm i -D tailwindcss@^4 @tailwindcss/vite tw-animate-css
```

Setup:
- `vite.config.ts`: add `tailwindcss()` to plugins, and `resolve.alias` `{ "@": "/src" }`.
- `tsconfig`: add `"baseUrl": "."` and `"paths": { "@/*": ["./src/*"] }`.
- One CSS entry imported in `main.tsx`, starting with `@import "tailwindcss";` then `@import "tw-animate-css";`, then the theme blocks.
- Copy `src/lib/utils.ts` (the `cn()` helper) and `src/hooks/use-media-query.ts` from the dashboard verbatim.
- `react-resizable-panels` is v4 here: `ResizablePanelGroup` with `orientation="horizontal"` and string-percent sizes like `defaultSize="15%"`. Use the dashboard's `ui/resizable.tsx` verbatim.

shadcn primitives (generate, then overwrite resizable, tabs, button, badge, dialog, command, popover with the dashboard versions for an exact match):

```
npx shadcn@latest init   # TypeScript, base color neutral, CSS variables yes
npx shadcn@latest add resizable tabs command button badge scroll-area \
  separator tooltip dialog dropdown-menu popover collapsible context-menu
```

## 5. Theme

Lift the `globals.css` theme blocks from the cloned dashboard verbatim (the `:root`, `.dark`, `@theme inline`, `@custom-variant dark`, `@layer base`, scrollbar, and `.shimmer-text` blocks). App boots in dark mode (put `class="dark"` on `<html>` in `index.html`). Replace `next-themes` with a tiny context that toggles `.dark` on `<html>`.

Dark palette for reference:

```
--background:#0a0a0a; --foreground:#e5e5e5; --card:#141414; --popover:#141414;
--primary:oklch(0.922 0 0); --primary-foreground:oklch(0.205 0 0);
--secondary:#1a1a1a; --muted:#1a1a1a; --muted-foreground:#737373;
--accent:#1a1a1a; --destructive:#ef4444;
--border:oklch(1 0 0 / 10%); --input:oklch(1 0 0 / 15%); --ring:oklch(0.556 0 0);
--sidebar:#141414; --success:#22c55e; --warning:#eab308; base --radius:0.625rem;
```

Body font: `system-ui, -apple-system, sans-serif`. `body { margin:0; overflow:hidden }` (panels scroll internally; the `min-h-0 + flex-1` chain is required or scrolling breaks).

## 6. Layout (use the dashboard `page.tsx` as the template)

Full-screen flex column: a top bar, then a horizontal `ResizablePanelGroup` with three panels.

- LEFT "Mission tree": `id="tree" defaultSize="15%" minSize="10%" maxSize="30%"`
- CENTER "Stage": `id="stage" defaultSize="55%" minSize="30%"`
- RIGHT tabbed panel: `id="side" defaultSize="30%" minSize="15%" maxSize="50%"`

`ResizableHandle` between each (thin, no `withHandle`). The right panel is a `Tabs` block (`variant="line"`, `h-7`, `text-[11px]` triggers): Steer (default), Activity, Console, Cost, Artifacts. Console shows a destructive dot when there are error-type log lines. Mobile (<768px): no resizable panels, a 3-tab fallback (Tree / Stage / Side). Every panel uses the idiom `<div className="flex h-full flex-col">` with a `shrink-0` header, a `flex-1 min-h-0 overflow-y-auto` body (or `ScrollArea`), optional `shrink-0` footer.

## 7. Data model (existing, read-only) and the integration contract

The store (`useSwarm`) is one flat object. Fields available: `mission`, `tasks`, `agents`, `log`, `gate`, `artifact`, `focusAgent`, `focusTask`, `memoryCount`, `lastSeq`. Cost is denormalized onto `mission` (`spentCents`, `budgetCents`, `stepCount`, `maxSteps`) and onto each task (`task.costCents`). Do not invent a cost slice.

SwarmEvent groups: lifecycle (`mission_started/completed/failed`), roster (`agent_spawned`), plan (`plan_created`), task flow (`task_claimed/completed/reviewed/failed`), reasoning (`agent_thought`, `memory_stored`, `memory_recalled`), artifact (`artifact_created`), control tower (`budget_updated`, `gate_tripped`, `intervention_applied`, `mission_paused`, `mission_resumed`, `task_killed`).

Build `src/state/selectors.ts` FIRST and lock the signatures. Thin hooks over `useSwarm`. Use `useShallow` (zustand v5) for composed objects to avoid re-render loops; memoize derived arrays.

```
useTopBar()      -> { goal, status, statusMeta, isLiveBackend, spentCents, budgetCents, stepCount, maxSteps, pct, pause, resume, raiseBudget }
useMissionTree() -> { mission, agents (6-role roster with live visual), tasks (Task[] sorted by orderIndex), focusAgent, focusTask, selectAgent(name), selectTask(id) }
useStage()       -> { stage: 'dag'|'artifact'|'browser', tasks, gate, focusTask, artifact, status }
useGate()        -> { gate, mission, gateTask, held }
useSteer()       -> { status, gate, held, approve, deny, inject, pause, resume, raiseBudget, kill }
useActivity()    -> LogLine[]                  // s.log
useConsole()     -> LogLine[]                  // s.log filtered to kind==='thought'
useCost()        -> { spentCents, budgetCents, stepCount, maxSteps, pct, over, near, ledger: {id,title,costCents,attempts,status}[] }
useArtifact()    -> { artifact, accepted, total, pct, failed }
useFocusDetail() -> { task, agent, deps, chain }  // lift Inspector's causal-chain logic
```

## 8. Build sequence and the 3-agent split

Step 1 (foundation, do before fanning out): add the stack, Tailwind v4 + shadcn, theme, `src/state/selectors.ts` (locked), `src/ui/IDEShell.tsx` (shell + global modal state for Auth and MissionHistory), `src/ui/TopBar.tsx` (wordmark, "running on InsForge" pill, budget meter, step counter, status pill, pause/resume, a Cmd+K command palette via cmdk-in-a-dialog whose actions wrap existing functions), and `src/ui/CommandPalette.tsx`.

Step 2 (spawn THREE parallel agents now, each owns separate NEW files, zero merge conflicts):

- AGENT A -> `src/ui/LeftTree.tsx` using `useMissionTree()`. Collapsible tree: missions (from `listMyMissions`, reuse MissionHistory load logic) > agents (reuse SwarmRoster rendering + `agentMeta`, click writes `setFocus`) > tasks (status dots from TaskBoard labels, click writes `setFocusTask`). Reuse the existing focus state; no new selection state.
- AGENT B -> `src/ui/CenterStage.tsx` using `useStage()` + `useGate()`. A SWAPPABLE stage slot keyed by `stage` ('dag' default, 'artifact', and a 'browser' case stubbed for Phase 2). Default 'dag' harvests `TaskBoard.tsx` nearly verbatim (keep its `useLayoutEffect` SVG edge-drawing and status CSS, reparent only). Show ProgressArtifact + inline ArtifactViewer when assembling or complete. Render GatePrompt as an overlay INSIDE the stage when a gate is held. GatePrompt is mounted ONCE, here.
- AGENT C -> `src/ui/RightTabs.tsx` + tab panels (SteerTab, ActivityTab, ConsoleTab, CostTab, ArtifactsTab) using `useActivity/useConsole/useCost/useSteer/useArtifact`. Steer is a textarea posting `injectNote` plus approve/deny/raise controls (reuse ControlBar + GatePrompt action logic), and a compact "gate active, see Stage" pointer (do NOT mount a second GatePrompt). Activity is MissionLog verbatim. Console is MissionLog filtered to thoughts. Cost is the meter + a per-task ledger. Artifacts is ProgressArtifact + ArtifactViewer.

Step 3 (after agents return): wire panels into IDEShell, reparent Auth + MissionHistory as global modals triggered from TopBar, delete `src/ui/Overlay.tsx`, update `src/App.tsx` to mount `<IDEShell/>`, split and prune `src/ui/overlay.css` into the new panels (keep tokens and `.glass` in `index.css`). Retire `src/scene/*` from the mounted path but keep the files on disk (already unmounted, write only focus state, so this is a no-op for runtime and tests). Keep `src/ui/agentMeta.ts` unchanged.

### Keep / Refactor / Retire

- KEEP UNCHANGED: `state/swarm.ts`, `state/simulation.ts`, `lib/types.ts`, `lib/insforge.ts`, `lib/mission.ts`, all `*.test.ts`, `ui/agentMeta.ts`, `index.css` tokens + `.glass`.
- REFACTOR into panels: Header, ControlBar, MissionConsole, TaskBoard, MissionLog, SwarmRoster, ProgressArtifact, ArtifactViewer, Inspector, GatePrompt, MissionHistory.
- KEEP, reparent: Auth (global modal).
- DELETE: `ui/Overlay.tsx` (replaced by IDEShell).
- RETIRE from mounted path, keep files: all of `src/scene/*`.

## 9. Verify before opening the PR

- `npm run lint` clean
- `npx tsc --noEmit` clean
- `npm test` all 40 pass
- `npm run build` succeeds
- Run locally with `?sim` and click through: launch a mission, watch tree + stage + activity update, hit the risk gate, approve and deny it, inject a note, open the artifact, open history and auth. Everything works offline via the sim.
- Scan the whole diff for em-dashes and remove any.

## 10. Pending planner live confirmation (the second LLM does NOT do these)

The planner holds the live InsForge CLI access and runs these after the branch is verified:
- JOB 1 (live QA on https://nmf6vbv4.insforge.site): browser-clicked verification of the new UI against the real backend (board live-updates, gate prompt, steering, artifact viewer, the anonymous-auth 401 polish). Leave flagged "PENDING planner live confirmation."
- deploy.md resolution: the live deploy of the new frontend and the deploy.md LIVE STATUS sign-off. Leave deploy.md pending items as "PENDING planner live deploy + confirmation." Do not edit deploy.md to claim resolution.

## 11. Phase 2 (stretch): live browser via agent-browser

Goal: one HIVE worker drives a real Chrome via agent-browser, and the CenterStage 'browser' slot streams the live viewport (with optional human take-over).

Facts:
- agent-browser is a native Rust + Chrome daemon, so it cannot run inside InsForge edge functions. Host it on a small external VM with Caddy in front for TLS (the HIVE site is https, so the stream must be wss).
- Control path: the worker POSTs JSON `{action, ...}` to the daemon `/api/command` relay. This is an external HTTPS call, NOT subject to the InsForge function-to-function 508 rule. The relay is guarded by a same-origin plus loopback check, so Caddy must rewrite Host and Origin to localhost, plus a bearer token you add (store it as an InsForge secret).
- View path: the React panel connects to `wss://<host>/api/session/<port>/stream` and paints base64 JPEG frames to a canvas. Take-over sends `input_mouse` / `input_keyboard` events back.
- Demo flow: a research worker opens real competitor or pricing pages, extracts text via snapshot + getText, the user watches live and can take over, the extracted text becomes a worker artifact fed into the mission.
- Put the whole panel behind a feature flag so a broken stream cannot crash the main UI.
- Cut line if time runs short: ship view-only first, then a screenshot-only fallback (poll `{action:"screenshot"}`), then drop Phase 2 entirely. Phase 1 ships untouched either way.
