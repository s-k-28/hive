/**
 * Camera. Idle behaviour: a slow auto-orbit around the core. On focusAgent it
 * smoothly frames that orb; back to the establishing shot on null.
 *
 * focusAgent is the one bit of reactive state the camera needs, so we read it
 * with a selector hook (cheap, flips rarely). The orb being focused is moving,
 * so we re-aim at its live orbit position for a short settle window after the
 * focus changes, then let CameraControls hold.
 */

import { useFrame } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSwarm } from '../state/swarm';
import { orbitFor, orbitPosition } from './layout';

const HOME = new THREE.Vector3(0, 4, 14);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const _orb = new THREE.Vector3();

export function CameraRig() {
  const controls = useRef<CameraControls>(null);
  const focus = useSwarm((s) => s.focusAgent);

  // Settle window: while > 0 we keep re-aiming at the (moving) focused orb.
  const settle = useRef(0);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (focus) {
      settle.current = 1.2; // seconds of active framing
    } else {
      settle.current = 0;
      c.setLookAt(HOME.x, HOME.y, HOME.z, ORIGIN.x, ORIGIN.y, ORIGIN.z, true);
    }
  }, [focus]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;

    if (focus) {
      const orbit = orbitFor(focus);
      if (orbit) {
        orbitPosition(orbit, state.clock.elapsedTime, _orb);
        if (settle.current > 0) {
          settle.current -= dt;
          // Frame the orb from slightly above and to the side.
          c.setLookAt(
            _orb.x + 2.6,
            _orb.y + 1.3,
            _orb.z + 2.6,
            _orb.x,
            _orb.y,
            _orb.z,
            true,
          );
        }
      }
    } else {
      // Idle auto-orbit.
      c.azimuthAngle += dt * 0.05;
    }
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.6}
      minDistance={4}
      maxDistance={26}
      // Keep the camera out of the floor on manual drag.
      maxPolarAngle={Math.PI * 0.85}
    />
  );
}
