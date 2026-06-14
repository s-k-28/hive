import { useEffect, useRef, type CSSProperties } from 'react';
import {
  ArrowRight,
  Boxes,
  Eye,
  Gauge,
  Hexagon,
  OctagonX,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import './design/marketing.css';
import { BrandMark, Button, Eyebrow, LiveIndicator } from './design/components';
import { HeroDeck } from './HeroDeck';

/**
 * HIVE marketing landing (v2: cinematic command). A drifting gradient
 * light-field hero with a kinetic spectrum headline and a live auto-playing
 * mini control deck, then an editorial numbered grid. "Launch the deck" enters
 * the live workspace (#app).
 */

const ICONS: Record<string, LucideIcon> = {
  ArrowRight,
  Eye,
  OctagonX,
  Gauge,
  Hexagon,
  Workflow,
  Boxes,
  ShieldCheck,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = ICONS[name];
  return C ? <C size={size} /> : null;
}

const INDICATORS = [
  { icon: 'Eye', ic: 'var(--d-live)', k: 'See', v: 'every step', d: 'Plan, reasoning, memory, cost, and critic verdicts stream live.' },
  { icon: 'OctagonX', ic: 'var(--d-red)', k: 'Stop', v: 'any agent', d: 'Pause the swarm or kill a task with one click, mid-flight.' },
  { icon: 'Gauge', ic: 'var(--d-amber)', k: 'Gate', v: 'the spend', d: 'Hard budget and step caps that halt and ask, never run away.' },
  { icon: 'Hexagon', ic: 'var(--d-grn)', k: '100%', v: 'on InsForge', d: 'Postgres, edge functions, AI gateway, pgvector, realtime, storage.' },
];

const STEPS = [
  { icon: 'Workflow', title: 'Delegate a goal', body: 'A planner agent decomposes your goal into a dependency-aware task graph, then spawns the swarm.' },
  { icon: 'Boxes', title: 'The swarm executes', body: 'Worker agents run tasks in parallel. A critic reviews every result and bounces weak work back for a retry.' },
  { icon: 'Eye', title: 'You stay in control', body: 'Watch each step stream. A cost meter and risk gates stop the swarm and ask before any high-impact move.' },
  { icon: 'ShieldCheck', title: 'It ships an artifact', body: 'The assembler delivers a finished, downloadable artifact with a full record of how it was built.' },
];

const STACK = [
  'Postgres task graph',
  'Edge-function agents',
  'AI gateway reasoning',
  'pgvector shared memory',
  'Realtime event streaming',
  'Auth + storage artifacts',
];

function useReveal() {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="lp">
      <div className="lp-field" aria-hidden="true">
        <div className="lp-bloom lp-bloom--a" />
        <div className="lp-bloom lp-bloom--b" />
        <div className="lp-bloom lp-bloom--c" />
        <div className="lp-bloom lp-bloom--d" />
      </div>

      <header className="lp-nav">
        <BrandMark size="md" onClick={onEnter} />
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#stack">Built on InsForge</a>
        </nav>
        <div className="lp-nav-right">
          <LiveIndicator mode="live" />
          <Button variant="primary" size="sm" iconRight={<Icon name="ArrowRight" size={15} />} onClick={onEnter}>
            Launch the deck
          </Button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <Eyebrow spectrum>AI agent control tower</Eyebrow>
          <h1 className="lp-h1">
            Run a team of AI agents you can <span className="verb verb--1">see</span>,{' '}
            <span className="verb verb--2">stop</span>, and <span className="verb verb--3">steer</span>.
          </h1>
          <p className="lp-sub">
            HIVE is the live control tower for autonomous agents. Delegate a goal, watch a transparent swarm plan,
            execute, and self-review in real time, with hard cost gates and one-click intervention. It runs entirely on
            InsForge.
          </p>
          <div className="lp-hero-cta">
            <Button variant="spectrum" size="lg" iconRight={<Icon name="ArrowRight" size={18} />} onClick={onEnter}>
              Launch the deck
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
            >
              See how it works
            </Button>
          </div>
        </div>
        <div className="lp-shot">
          <div className="lp-shot-bar">
            <i />
            <i />
            <i />
            <em>hive control deck</em>
          </div>
          <HeroDeck />
        </div>
      </section>

      <Band />
      <How />
      <Stack />

      <section className="lp-final">
        <h2 className="lp-final-h">
          Point it at a goal.
          <br />
          Watch it work.
        </h2>
        <div className="lp-final-cta">
          <Button variant="spectrum" size="lg" iconRight={<Icon name="ArrowRight" size={18} />} onClick={onEnter}>
            Launch the deck
          </Button>
        </div>
        <p className="lp-final-note">Built for the InsForge Hack.</p>
      </section>

      <footer className="lp-foot">
        <BrandMark size="sm" />
        <span className="lp-foot-tag">The live control tower for AI agents.</span>
        <span className="lp-foot-live">
          <LiveIndicator mode="live" />
        </span>
      </footer>
    </div>
  );
}

function Band() {
  const ref = useReveal();
  return (
    <section className="lp-section d-reveal" ref={ref}>
      <div className="lp-sec-head">
        <span className="lp-sec-num">01</span>
        <div>
          <Eyebrow muted tight>
            Why HIVE
          </Eyebrow>
          <p className="lp-sec-lead" style={{ marginTop: 10 }}>
            Agents ship to production faster than anyone can govern them. One unattended loop can burn a budget
            overnight; one bad write can wipe a database. HIVE makes the swarm{' '}
            <strong>observable, interruptible, and accountable</strong>.
          </p>
        </div>
      </div>
      <div className="lp-cards">
        {INDICATORS.map(({ icon, ic, k, v, d }) => (
          <div className="lp-card" key={k}>
            <span className="lp-card-icon" style={{ '--ic': ic } as CSSProperties}>
              <Icon name={icon} size={18} />
            </span>
            <div className="lp-card-k">
              {k} <span>{v}</span>
            </div>
            <p className="lp-card-d">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function How() {
  const ref = useReveal();
  return (
    <section className="lp-section d-reveal" id="how" ref={ref}>
      <div className="lp-sec-head">
        <span className="lp-sec-num">02</span>
        <div>
          <Eyebrow muted tight>
            How it works
          </Eyebrow>
          <h2 className="lp-h2" style={{ marginTop: 10 }}>
            A transparent swarm,
            <br />
            under your command.
          </h2>
        </div>
      </div>
      <div className="lp-steps">
        {STEPS.map(({ icon, title, body }, i) => (
          <div className="lp-step" key={title}>
            <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="lp-step-icon">
              <Icon name={icon} size={20} />
            </span>
            <h3 className="lp-step-title">{title}</h3>
            <p className="lp-step-body">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stack() {
  const ref = useReveal();
  return (
    <section className="lp-section d-reveal" id="stack" ref={ref}>
      <div className="lp-sec-head">
        <span className="lp-sec-num">03</span>
        <div>
          <Eyebrow muted tight>
            Built on InsForge
          </Eyebrow>
          <h2 className="lp-h2" style={{ marginTop: 10 }}>
            The whole swarm runs
            <br />
            on one backend.
          </h2>
          <p className="lp-sec-sub">
            Every agent, message, memory, and artifact lives in InsForge primitives. No glue infra, no second cloud.
          </p>
        </div>
      </div>
      <div className="lp-chips">
        {STACK.map((s) => (
          <span className="lp-chip" key={s}>
            <Icon name="Hexagon" size={13} />
            {s}
          </span>
        ))}
      </div>
    </section>
  );
}
