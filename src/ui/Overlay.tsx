import './overlay.css';
import { useEffect, useState } from 'react';
import { Header } from './Header';
import { MissionConsole } from './MissionConsole';
import { MissionLog } from './MissionLog';
import { SwarmRoster } from './SwarmRoster';
import { ProgressArtifact } from './ProgressArtifact';
import { ControlBar } from './ControlBar';
import { GatePrompt } from './GatePrompt';
import { Inspector } from './Inspector';
import { Auth } from './Auth';
import { MissionHistory } from './MissionHistory';
import { getCurrentUser, type AuthUser } from '../lib/mission';
import { useSwarm } from '../state/swarm';

/**
 * Glassmorphic DOM overlay above the mission board. The reactive consumer of the
 * swarm store. The root is transparent to pointer events; only children marked
 * `.interactive` capture input, so clicks fall through to the board everywhere
 * else.
 *
 * Control tower additions: a ControlBar (pause/resume, cost meter, steps), the
 * GatePrompt (the stop-and-ask moment), the causal Inspector, and the Auth and
 * MissionHistory modals surfaced from the header.
 */
export function Overlay() {
  const mission = useSwarm((s) => s.mission);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Resolve the signed-in user once on mount (no-op in offline mode).
  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  return (
    <div className="overlay">
      <Header
        user={user}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />
      <MissionConsole />
      {mission ? <ControlBar /> : null}
      <MissionLog />
      <SwarmRoster />
      <ProgressArtifact />
      <GatePrompt />
      <Inspector />

      {authOpen ? (
        <Auth user={user} onChange={setUser} onClose={() => setAuthOpen(false)} />
      ) : null}
      {historyOpen ? <MissionHistory onClose={() => setHistoryOpen(false)} /> : null}
    </div>
  );
}
