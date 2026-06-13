# HIVE Follow-up: commit to the 2D board and make it excellent

You previously built the HIVE control tower, then swapped the 3D scene for a
static 2D task board. The product decision is final: keep the 2D board as the
single live view. This follow-up has two jobs. Do both completely. No em-dashes
anywhere. Keep lint, typecheck, build, and all tests green, and zero console
errors, before you push.

Work in the `s-k-28/hive` repo. Read `docs/PRD.md` and `docs/BUILD_PROMPT.md`
first for the product intent, but note that the 3D direction in those docs is
superseded by this decision; the 2D board is the product now.

## Job 1: make the whole repo true to the 2D reality

The README and other copy still claim a cinematic 3D mission control, which the
app no longer renders. Find and fix every such claim so the repo is honest and
consistent. At minimum, in `README.md`:

- The hero line ("rendered as a cinematic 3D mission control") becomes an honest
  description of the live mission board.
- The "Why this matters" closing line ("The 3D mission control is how that
  control is made tangible...") is rewritten around the 2D board: oversight is
  the architecture because every card is a Postgres row and every change is a
  realtime event.
- The Realtime row in the primitive table ("The 3D scene, the cost meter, and the
  gate prompt all react live") drops "3D scene" and names the live board.
- The ASCII architecture diagram's "3D scene (transient reads, 60fps)" line
  becomes the live mission board.
- The swarm section's mention of the scene showing a red pulse on a node is
  reworded to the board's reject animation.
- Scan the entire README for any other "3D", "three", "react-three-fiber",
  "canvas", or "scene" reference presented as the live UI and correct it.

Also check and fix, if present: the `<title>` and meta description in
`index.html`, and any "3D" copy in `src/ui/Header.tsx` or other UI text.

Leave the dormant 3D code in `src/scene/` in place (do not delete it), but do not
present it anywhere as the live experience. Do not advertise it in the README.

## Job 2: elevate the 2D board from static to a premium, alive mission view

The board is now the entire visual identity of the product, so it must be
genuinely beautiful and feel alive, not a plain kanban. Upgrade `TaskBoard.tsx`
and its styles to a hero-quality bar while keeping it DOM-only and fast:

- **Layout:** dependency-depth columns (or a clear DAG layout) of glass task
  cards, with visible connectors or lines showing the dependency edges between
  cards so the graph structure reads at a glance.
- **Live motion:** smooth, tasteful transitions on every state change (a card
  animating from pending to running to review to accepted), a subtly animated
  "working" indicator on running cards, and newly created cards easing in when
  the plan lands. Respect prefers-reduced-motion.
- **Status as design:** each task status (pending, running, review, accepted,
  rejected, failed, killed) has a distinct, premium visual treatment (color,
  glow, border), consistent with the existing design tokens in `src/index.css`.
- **Governance made visible:** a gated card shows a clear pulsing amber state and
  surfaces the GatePrompt; a live cost meter on the board (or header) animates as
  spend climbs and visibly approaches the budget; the step counter is present.
- **Interaction:** every card is clickable to open the causal Inspector
  (`setFocusTask`); hover and focus states are crisp; keyboard accessible.
- **Polish:** glassmorphism done tastefully (blur, hairline borders, soft inner
  glow), generous spacing, real type hierarchy, no generic AI-template look. It
  should look like a shipped product an InsForge judge would screenshot.

Keep it performant (no layout thrash, no per-frame DOM work) and accessible.

## Verification and delivery

- Run the full gauntlet until green: `npm run lint && npm run build && npx vitest run`.
- Drive `http://localhost:5173/?sim` and confirm the full control-tower flow on
  the board: plan appears, cost meter climbs, the risk gate pauses with the amber
  state and the GatePrompt, you approve and inject and raise budget and kill, the
  Inspector opens on a card click, the mission completes and the artifact opens.
  Assert zero console and zero page errors. Capture before-and-after screenshots.
- Commit with clear messages ending in
  `Co-Authored-By: Claude <noreply@anthropic.com>`. Scan the diff for
  secret-shaped strings (`ik_`, `sk-`, `sk-or-`, `gho_`, `AKIA`) before pushing.
  Push to `origin` (https://github.com/s-k-28/hive), repo stays public.

Make the board so good that nobody misses the 3D.
