import { useState } from 'react';
import { useSwarm } from '../state/swarm';
import { pauseMission, resumeMission } from '../lib/mission';

/**
 * A minimal command palette (Cmd/Ctrl K). Filterable actions that wrap the
 * existing mission controls. Escape or backdrop click closes it.
 */

interface Action {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  if (!open) return null;

  const actions: Action[] = [
    { id: 'new', label: 'New mission', hint: 'reset the deck', run: () => useSwarm.getState().reset() },
    { id: 'pause', label: 'Pause the swarm', hint: 'hold all agents', run: () => pauseMission() },
    { id: 'resume', label: 'Resume the swarm', hint: 'release the hold', run: () => resumeMission() },
  ];
  const filtered = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="cmd-backdrop" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <input
          className="cmd-input"
          autoFocus
          placeholder="Type a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && filtered[0]) {
              filtered[0].run();
              onClose();
            }
          }}
        />
        <div className="cmd-list">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className="cmd-item"
              onClick={() => {
                a.run();
                onClose();
              }}
            >
              <span>{a.label}</span>
              <span className="cmd-hint">{a.hint}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="cmd-empty">No commands match.</div>}
        </div>
      </div>
    </div>
  );
}
