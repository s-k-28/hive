import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './ui/workspace.css';
import App from './App.tsx';
import { runSimulation } from './state/simulation';

// Dev harness: replay a scripted mission through the same event path the
// realtime channel uses, so the scene and overlay animate without a backend.
// Replaced by the live mission flow once the backend is wired.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('sim')) {
  setTimeout(() => runSimulation(), 1200);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
