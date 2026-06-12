/**
 * Housekeeping ticker. Calls pruneFx() about once a second to drop stale
 * one-shot effects (reject pulses, recall threads) from the store, which
 * unmounts their components. Runs off the render loop with a frame counter so
 * it costs almost nothing and never calls setState from inside the per-frame
 * hot path of other components.
 */

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { pruneFx } from '../state/swarm';

export function SceneClock() {
  const acc = useRef(0);

  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current >= 1) {
      acc.current = 0;
      pruneFx();
    }
  });

  return null;
}
