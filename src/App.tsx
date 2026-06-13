import { TaskBoard } from './ui/TaskBoard';
import { Overlay } from './ui/Overlay';

/**
 * Composition root.
 *
 * The 3D scene (react-three-fiber) has been swapped out for a static, DOM-only
 * task board for now. The scene code still lives in src/scene/ and can be
 * reinstated by importing Scene from './scene/Scene' in place of TaskBoard.
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
