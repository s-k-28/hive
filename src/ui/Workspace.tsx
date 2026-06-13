import { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TopBar } from './TopBar';
import { MissionTree } from './MissionTree';
import { Stage } from './Stage';
import { Inspector } from './InspectorPanel';
import { StatusStrip } from './StatusStrip';
import { CommandPalette } from './CommandPalette';

/**
 * The HIVE Control Deck. A resizable three-column workspace (mission tree,
 * stage, inspector) under the command bar and over the live status strip.
 */
export function Workspace() {
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="ws-app">
      <TopBar onOpenPalette={() => setPalette(true)} />
      <div className="ws-body">
        <Group orientation="horizontal" id="hive-deck" className="ws-pg">
          <Panel id="tree" defaultSize="17%" minSize="12%" maxSize="28%">
            <MissionTree />
          </Panel>
          <Separator className="ws-handle" />
          <Panel id="stage" defaultSize="56%" minSize="34%">
            <div className="ws-panel ws-panel--center">
              <Stage />
            </div>
          </Panel>
          <Separator className="ws-handle" />
          <Panel id="inspector" defaultSize="27%" minSize="18%" maxSize="44%">
            <Inspector />
          </Panel>
        </Group>
      </div>
      <StatusStrip />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
