import { Scene } from './scene/Scene';
import { Overlay } from './ui/Overlay';

/**
 * Composition root. Ownership boundaries:
 *  - src/scene/** owns everything inside the Canvas (entry: Scene)
 *  - src/ui/**    owns the DOM overlay (entry: Overlay)
 *  - src/state/** is the only bridge between them
 */
export default function App() {
  return (
    <div className="app">
      <Scene />
      <Overlay />
    </div>
  );
}
