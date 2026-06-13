import { useEffect, useState } from 'react';
import { Workspace } from './ui/Workspace';
import { Landing } from './ui/Landing';

/**
 * Composition root. A lightweight hash route: the marketing landing page is the
 * entry, and "Launch the deck" (or visiting #app) enters the live control deck.
 * The dormant react-three-fiber scene and the previous cockpit overlay remain on
 * disk for reference only and are not mounted.
 */

function currentView(): 'landing' | 'app' {
  return window.location.hash === '#app' ? 'app' : 'landing';
}

export default function App() {
  const [view, setView] = useState<'landing' | 'app'>(currentView);

  useEffect(() => {
    const onHash = () => setView(currentView());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (view === 'app') return <Workspace />;
  return <Landing onEnter={() => { window.location.hash = 'app'; }} />;
}
