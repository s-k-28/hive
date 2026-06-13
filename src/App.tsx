import { TaskBoard } from './ui/TaskBoard';
import { Overlay } from './ui/Overlay';

/**
 * Composition root.
 *
 * The live swarm view is the DOM mission board (TaskBoard). A dormant
 * react-three-fiber scene remains under src/scene/ for reference only and is not
 * mounted by the app.
 *
 * Ownership boundaries:
 *  - src/ui/**    owns the DOM (entry: TaskBoard for the swarm view, Overlay for the cockpit)
 *  - src/state/** is the only bridge between views
 */
export default function App() {
  return (
    <div className="app">
      <TaskBoard />
      <Overlay />
    </div>
  );
}
