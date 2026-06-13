import { useSwarm } from '../state/swarm';
import { TaskBoard } from './TaskBoard';
import { GatePrompt } from './GatePrompt';
import { LaunchBriefing } from './LaunchBriefing';

/**
 * The center stage. Shows the launch briefing until a mission exists, a planning
 * state while the planner decomposes the goal, then the live task graph. The
 * gate prompt overlays the stage when the swarm stops to ask the operator.
 */
export function Stage() {
  const mission = useSwarm((s) => s.mission);
  const taskCount = useSwarm((s) => Object.keys(s.tasks).length);

  return (
    <div className="ws-stage">
      {!mission && <LaunchBriefing />}
      {mission && taskCount === 0 && (
        <div className="ws-planning">
          <div className="ws-planning-ring" aria-hidden="true" />
          <div className="ws-planning-text">Planning the mission</div>
        </div>
      )}
      {mission && taskCount > 0 && <TaskBoard />}
      <GatePrompt />
    </div>
  );
}
