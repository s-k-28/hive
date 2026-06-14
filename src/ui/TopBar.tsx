import { Hexagon, Play, Pause, User, Clock, Boxes, GitBranch } from 'lucide-react';
import { useSwarm } from '../state/swarm';
import { useCost } from '../state/selectors';
import { isLiveBackend } from '../lib/insforge';
import { pauseMission, resumeMission, type AuthUser } from '../lib/mission';
import { MISSION_STATUS_META } from './agentMeta';

/**
 * The command bar. Brand, live backend pill, the active mission identity, and
 * the operator's at-a-glance instruments: cost meter, step counter, pause or
 * resume, account, mission history, and the command palette.
 */

const fmt = (c: number): string => `$${(c / 100).toFixed(2)}`;

interface TopBarProps {
  user: AuthUser | null;
  onOpenPalette: () => void;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
  onOpenLibrary: () => void;
}

export function TopBar({ user, onOpenPalette, onOpenAuth, onOpenHistory, onOpenLibrary }: TopBarProps) {
  const mission = useSwarm((s) => s.mission);
  const cost = useCost();

  const meta = mission ? MISSION_STATUS_META[mission.status] : null;
  const terminal = mission?.status === 'complete' || mission?.status === 'failed';
  const held = mission?.status === 'paused' || mission?.status === 'awaiting_input';
  const canPause =
    mission?.status === 'running' ||
    mission?.status === 'planning' ||
    mission?.status === 'assembling';

  return (
    <header className="ws-top">
      <button type="button" className="ws-brand" onClick={() => { window.location.hash = ''; }} title="Home">
        <span className="ws-brand-hex"><Hexagon size={19} strokeWidth={2.2} /></span>
        <span className="ws-word">HIVE</span>
      </button>

      <span className="ws-live" data-mode={isLiveBackend ? 'live' : 'sim'}>
        <span className="ws-live-dot" />
        {isLiveBackend ? 'running on InsForge' : 'local simulation'}
      </span>

      <div className="ws-mission">
        {mission ? (
          <>
            <span className="ws-mission-goal" title={mission.goal}>{mission.goal}</span>
            {mission.repo && (
              <span className="ws-mission-repo" title={`${mission.repo.fullName} @ ${mission.repo.ref}`}>
                <GitBranch size={12} aria-hidden="true" />
                {mission.repo.fullName}
              </span>
            )}
            {meta && (
              <span className="ws-pill" style={{ ['--pill' as string]: meta.tone }}>
                <span className="ws-pill-dot" aria-hidden="true" />
                {meta.label}
              </span>
            )}
          </>
        ) : (
          <span className="ws-mission-tag">The live control tower for AI agents</span>
        )}
      </div>

      {mission && !terminal && cost && (
        <>
          <div className="ws-meter" data-state={cost.over ? 'over' : cost.near ? 'near' : 'ok'}>
            <div className="ws-meter-top">
              <span className="ws-meter-label">Cost</span>
              <span className="ws-meter-val">
                {fmt(cost.spentCents)}
                {cost.budgetCents != null ? (
                  <>
                    <span className="sep">/</span>
                    {fmt(cost.budgetCents)}
                  </>
                ) : (
                  <span className="cap"> no cap</span>
                )}
              </span>
            </div>
            {cost.budgetCents != null && (
              <div className="ws-meter-track">
                <div className="ws-meter-fill" style={{ width: `${cost.pct}%` }} />
              </div>
            )}
          </div>

          <span className="ws-steps" title="Reasoning steps">
            <b>{cost.stepCount}</b>
            {cost.maxSteps != null ? `/${cost.maxSteps}` : ''}
            <span className="lbl">steps</span>
          </span>

          <button
            type="button"
            className="ws-btn"
            onClick={() => (held ? resumeMission() : pauseMission())}
            disabled={!canPause && !held}
            title={held ? 'Resume the swarm' : 'Pause the swarm'}
          >
            {held ? <Play size={13} /> : <Pause size={13} />}
            {held ? 'Resume' : 'Pause'}
          </button>
        </>
      )}

      {terminal && (
        <button type="button" className="ws-btn ws-btn--amber" onClick={() => useSwarm.getState().reset()}>
          New mission
        </button>
      )}

      {isLiveBackend && (
        <>
          <button type="button" className="ws-btn ws-btn--icon" onClick={onOpenHistory} title="Your missions">
            <Clock size={15} />
          </button>
          <button type="button" className="ws-btn" onClick={onOpenAuth} title="Account">
            <User size={14} />
            {user ? (user.name || user.email?.split('@')[0] || 'Account') : 'Sign in'}
          </button>
        </>
      )}

      <button type="button" className="ws-btn ws-btn--icon" onClick={onOpenLibrary} title="Agent library">
        <Boxes size={15} />
      </button>

      <button type="button" className="ws-kbd" onClick={onOpenPalette} title="Command palette">
        <kbd>&#8984;</kbd><kbd>K</kbd>
      </button>
    </header>
  );
}
