/**
 * The HIVE cinematic 3D scene. Full-bleed Canvas containing the entire
 * experience: energy core, six orbiting agents, the task DAG with flow beams,
 * the memory constellation, the camera rig, and the post stack.
 *
 * Ownership: this subtree owns everything inside the Canvas. It reads the swarm
 * store (state) and the protocol (lib) but never mutates them beyond setFocus,
 * which the store exposes for exactly this purpose. Realtime events drive every
 * animation transiently inside useFrame, so the canvas tree never re-renders on
 * mission activity, only on the structural facts (which tasks/effects exist).
 */

import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import { useSwarm } from '../state/swarm';
import { ORBITS } from './layout';
import { Background } from './Background';
import { EnergyCore } from './EnergyCore';
import { AgentOrb } from './AgentOrb';
import { TaskGraph } from './TaskGraph';
import { Constellation } from './Constellation';
import { Effects } from './Effects';
import { CameraRig } from './CameraRig';
import { SceneClock } from './SceneClock';
import './scene.css';

export function Scene() {
  // Esc clears focus. Keydown is a DOM concern, handled here on the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useSwarm.getState().setFocus(null);
        useSwarm.getState().setFocusTask(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: false }}
      shadows={false}
      camera={{ position: [0, 4, 14], fov: 45 }}
      frameloop="always"
      // Clicking empty space (no mesh hit) deselects the focused agent or task.
      onPointerMissed={() => {
        useSwarm.getState().setFocus(null);
        useSwarm.getState().setFocusTask(null);
      }}
    >
      <color attach="background" args={['#05070f']} />

      <ambientLight intensity={0.18} />

      <Suspense fallback={null}>
        <Background />
        <Constellation />
        <EnergyCore />
        {ORBITS.map((orbit) => (
          <AgentOrb key={orbit.name} orbit={orbit} />
        ))}
        <TaskGraph />
      </Suspense>

      <CameraRig />
      <SceneClock />
      <Effects />
    </Canvas>
  );
}
