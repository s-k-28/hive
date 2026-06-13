import { Hexagon, ArrowRight, Eye, OctagonX, Gauge, Workflow, ShieldCheck, Boxes } from 'lucide-react';
import { isLiveBackend } from '../lib/insforge';

/**
 * The HIVE marketing landing page. Follows the "Real-Time / Operations" landing
 * pattern: hero with a live product preview, key capability indicators, a how-it
 * -works flow, the InsForge tech band, and a closing call to action. Dark Mode
 * (OLED) aesthetic, unified with the control deck. "Launch the deck" enters the
 * live app.
 */

const INDICATORS = [
  { icon: Eye, k: 'See', v: 'every step', d: 'Plan, reasoning, memory, cost, and critic verdicts stream live.' },
  { icon: OctagonX, k: 'Stop', v: 'any agent', d: 'Pause the swarm or kill a task with one click, mid-flight.' },
  { icon: Gauge, k: 'Gate', v: 'the spend', d: 'Hard budget and step caps that halt and ask, never run away.' },
  { icon: Hexagon, k: '100%', v: 'on InsForge', d: 'Postgres, edge functions, AI gateway, pgvector, realtime, storage.' },
];

const STEPS = [
  { icon: Workflow, title: 'Delegate a goal', body: 'A planner agent decomposes your goal into a dependency-aware task graph, then spawns the swarm.' },
  { icon: Boxes, title: 'The swarm executes', body: 'Worker agents run tasks in parallel. A critic reviews every result and bounces weak work back for a retry.' },
  { icon: Eye, title: 'You stay in control', body: 'Watch each step stream. A cost meter and risk gates stop the swarm and ask before any high-impact move.' },
  { icon: ShieldCheck, title: 'It ships an artifact', body: 'The assembler delivers a finished, downloadable artifact with a full causal record of how it was built.' },
];

const STACK = [
  'Postgres task graph',
  'Edge-function agents',
  'AI gateway reasoning',
  'pgvector shared memory',
  'Realtime event streaming',
  'Auth + storage artifacts',
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="lp">
      <div className="lp-grid" aria-hidden="true" />

      <header className="lp-nav">
        <div className="lp-brand">
          <span className="lp-brand-hex"><Hexagon size={20} strokeWidth={2.2} /></span>
          <span className="lp-word">HIVE</span>
        </div>
        <nav className="lp-links">
          <a href="#how">How it works</a>
          <a href="#stack">Built on InsForge</a>
        </nav>
        <span className="lp-live" data-mode={isLiveBackend ? 'live' : 'sim'}>
          <span className="lp-live-dot" />
          {isLiveBackend ? 'running on InsForge' : 'local build'}
        </span>
        <button type="button" className="lp-cta lp-cta--sm" onClick={onEnter}>
          Launch the deck <ArrowRight size={15} />
        </button>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow">AI agent control tower</div>
          <h1 className="lp-h1">
            Run a team of AI agents you can <em>see</em>, <em>stop</em>, and <em>steer</em>.
          </h1>
          <p className="lp-sub">
            HIVE is the live control tower for autonomous agents. Delegate a goal, watch a transparent
            swarm plan, execute, and self-review in real time, with hard cost gates and one-click
            intervention. It runs entirely on InsForge.
          </p>
          <div className="lp-hero-cta">
            <button type="button" className="lp-cta" onClick={onEnter}>
              Launch the deck <ArrowRight size={16} />
            </button>
            <a className="lp-ghost" href="#how">See how it works</a>
          </div>
        </div>
        <div className="lp-shot">
          <div className="lp-shot-bar">
            <span /><span /><span />
            <em>hive control deck</em>
          </div>
          <img src="/deck-preview.png" alt="The HIVE control deck running a live mission" />
        </div>
      </section>

      <section className="lp-band">
        <p className="lp-band-lead">
          Agents are shipping to production faster than anyone can govern them. One unattended loop can
          burn a budget overnight; one bad write can wipe a database. HIVE makes the swarm{' '}
          <strong>observable, interruptible, and accountable</strong>.
        </p>
        <div className="lp-cards">
          {INDICATORS.map(({ icon: Icon, k, v, d }) => (
            <div className="lp-card" key={k}>
              <span className="lp-card-icon"><Icon size={18} /></span>
              <div className="lp-card-k">{k} <span>{v}</span></div>
              <p className="lp-card-d">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-how" id="how">
        <div className="lp-sec-head">
          <span className="lp-sec-eyebrow">How it works</span>
          <h2 className="lp-h2">A transparent swarm, under your command.</h2>
        </div>
        <div className="lp-steps">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div className="lp-step" key={title}>
              <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
              <span className="lp-step-icon"><Icon size={20} /></span>
              <h3 className="lp-step-title">{title}</h3>
              <p className="lp-step-body">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-stack" id="stack">
        <div className="lp-sec-head">
          <span className="lp-sec-eyebrow">Built on InsForge</span>
          <h2 className="lp-h2">The whole swarm runs on one backend.</h2>
          <p className="lp-sec-sub">
            Every agent, message, memory, and artifact lives in InsForge primitives. No glue infra,
            no second cloud.
          </p>
        </div>
        <div className="lp-chips">
          {STACK.map((s) => <span className="lp-chip" key={s}>{s}</span>)}
        </div>
      </section>

      <section className="lp-final">
        <h2 className="lp-final-h">Point it at a goal. Watch it work.</h2>
        <button type="button" className="lp-cta lp-cta--lg" onClick={onEnter}>
          Launch the deck <ArrowRight size={18} />
        </button>
        <p className="lp-final-note">Built for the InsForge Hack.</p>
      </section>

      <footer className="lp-foot">
        <div className="lp-brand">
          <span className="lp-brand-hex"><Hexagon size={16} strokeWidth={2.2} /></span>
          <span className="lp-word">HIVE</span>
        </div>
        <span className="lp-foot-tag">The live control tower for AI agents.</span>
        <span className="lp-foot-live"><span className="lp-live-dot" />running on InsForge</span>
      </footer>
    </div>
  );
}
