import './overlay.css';
import { Header } from './Header';
import { MissionConsole } from './MissionConsole';
import { MissionLog } from './MissionLog';
import { SwarmRoster } from './SwarmRoster';
import { ProgressArtifact } from './ProgressArtifact';

interface OverlayProps {
  /**
   * Presentational sign-in affordance. Left unwired here; the host wires it to
   * InsForge auth. Omit to hide the control.
   */
  onSignIn?: () => void;
}

/**
 * Glassmorphic DOM overlay above the 3D scene. The reactive consumer of the
 * swarm store (the scene is the transient consumer). The root is transparent
 * to pointer events; only children marked `.interactive` capture input, so
 * clicks fall through to the canvas everywhere else.
 */
export function Overlay({ onSignIn }: OverlayProps) {
  return (
    <div className="overlay">
      <Header onSignIn={onSignIn} />
      <MissionConsole />
      <MissionLog />
      <SwarmRoster />
      <ProgressArtifact />
    </div>
  );
}
