import { Workspace } from './ui/Workspace';

/**
 * Composition root. The HIVE Control Deck: a Cursor-style multi-panel workspace
 * over the live swarm store. The dormant react-three-fiber scene under
 * src/scene/ and the previous cockpit overlay remain on disk for reference only
 * and are not mounted.
 */
export default function App() {
  return <Workspace />;
}
