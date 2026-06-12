/**
 * One agent orb. Mounted once per roster member up front (never conditionally),
 * it orbits the core and animates purely from its own runtime row read
 * transiently inside useFrame:
 *   idle     slow orbit + gentle breath
 *   thinking pulse emissive 2 -> 6, halo particles spin up, brighter
 *   complete spike to ~12 then decay back to idle
 *   error    emissive swaps red, an expanding shockwave ring fades out
 *
 * A drei <Html> chip fades the agent name in. Clicking focuses the camera.
 */

import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { damp, dampC } from 'maath/easing';
import { useSwarm } from '../state/swarm';
import type { OrbitParams } from './layout';
import { orbitPosition } from './layout';
import './scene.css';

const HALO_COUNT = 18;

// Hoisted scratch, shared across all orbs since useFrame runs them serially.
const _pos = new THREE.Vector3();
const _idleColor = new THREE.Color();
const _errColor = new THREE.Color('#ff2244');
const _dummy = new THREE.Object3D();

interface AgentOrbProps {
  orbit: OrbitParams;
}

export function AgentOrb({ orbit }: AgentOrbProps) {
  const group = useRef<THREE.Group>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const [labelOn, setLabelOn] = useState(false);
  // Show the name chip only on hover or when this agent is camera-focused, so
  // the idle scene stays clean. This is the one reactive read in the orb; it
  // re-renders just on focus change (six orbs, rare), never per frame.
  const focused = useSwarm((s) => s.focusAgent === orbit.name);

  const baseColor = useMemo(() => new THREE.Color(orbit.color), [orbit.color]);
  const haloPhases = useMemo(
    () => Float32Array.from({ length: HALO_COUNT }, (_, i) => i / HALO_COUNT),
    [],
  );

  // Smoothed per-orb drivers held across frames.
  const drive = useRef({ think: 0, glow: 1.5, errorAt: -1, ringT: 1 });

  const onClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    useSwarm.getState().setFocus(orbit.name);
  };

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const rt = useSwarm.getState().agents[orbit.name];
    const visual = rt?.visual ?? 'idle';

    // Orbit placement.
    if (group.current) {
      orbitPosition(orbit, t, _pos);
      group.current.position.copy(_pos);
    }

    const d = drive.current;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.0 + orbit.phase);

    // Target emissive + thinking-halo weight by visual state.
    let targetGlow: number;
    let targetThink: number;
    if (visual === 'thinking') {
      targetGlow = 2 + pulse * 4; // 2 -> 6
      targetThink = 1;
    } else if (visual === 'complete') {
      // Spike then decay: ride how long since the state change.
      const since = rt ? (performance.now() - rt.visualSince) / 1000 : 1;
      targetGlow = since < 0.18 ? 12 : 1.5 + Math.max(0, 6 - since * 6);
      targetThink = 0;
    } else if (visual === 'error') {
      targetGlow = 6 + pulse * 2;
      targetThink = 0;
    } else {
      targetGlow = 1.4 + pulse * 0.5; // idle breath
      targetThink = 0;
    }

    damp(d, 'glow', targetGlow, 0.12, dt);
    damp(d, 'think', targetThink, 0.18, dt);

    if (coreMat.current) {
      coreMat.current.emissiveIntensity = d.glow;
      _idleColor.copy(baseColor);
      dampC(coreMat.current.emissive, visual === 'error' ? _errColor : _idleColor, 0.1, dt);
    }

    // Thinking halo: ring of embers spinning around the orb, scaled by think.
    if (halo.current) {
      const w = d.think;
      halo.current.visible = w > 0.02;
      if (halo.current.visible) {
        const r = 0.55;
        for (let i = 0; i < HALO_COUNT; i++) {
          const a = t * 1.6 + haloPhases[i] * Math.PI * 2;
          _dummy.position.set(
            Math.cos(a) * r,
            Math.sin(t * 2.2 + i) * 0.12,
            Math.sin(a) * r,
          );
          _dummy.scale.setScalar(0.05 * w * (0.6 + 0.4 * Math.sin(a * 2)));
          _dummy.updateMatrix();
          halo.current.setMatrixAt(i, _dummy.matrix);
        }
        halo.current.instanceMatrix.needsUpdate = true;
      }
    }

    // Error shockwave: latch on entry to error, expand + fade a ring once.
    if (rt && visual === 'error' && rt.visualSince !== d.errorAt) {
      d.errorAt = rt.visualSince;
      d.ringT = 0;
    }
    if (d.ringT < 1) {
      d.ringT = Math.min(1, d.ringT + dt * 1.6);
      if (ring.current && ringMat.current) {
        ring.current.visible = true;
        const scale = 0.5 + d.ringT * 3.2;
        ring.current.scale.setScalar(scale);
        ringMat.current.opacity = (1 - d.ringT) * 0.9;
      }
    } else if (ring.current) {
      ring.current.visible = false;
    }
  });

  return (
    <group ref={group}>
      {/* Orb body */}
      <mesh onClick={onClick} onPointerOver={() => setLabelOn(true)} onPointerOut={() => setLabelOn(false)}>
        <icosahedronGeometry args={[0.34, 3]} />
        <meshStandardMaterial
          ref={coreMat}
          color="#05070f"
          emissive={orbit.color}
          emissiveIntensity={1.5}
          roughness={0.3}
          metalness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* Thinking halo (hidden until thinking) */}
      <instancedMesh ref={halo} args={[undefined, undefined, HALO_COUNT]} frustumCulled={false} visible={false}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color={new THREE.Color(orbit.color).multiplyScalar(2.4)} toneMapped={false} />
      </instancedMesh>

      {/* Error shockwave ring (hidden until error) */}
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.34, 0.42, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color={new THREE.Color('#ff2244').multiplyScalar(3)}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>

      {/* Name chip */}
      <Html center distanceFactor={11} pointerEvents="none" zIndexRange={[20, 0]}>
        <div className={`orb-label${labelOn || focused ? ' on' : ''}`} style={{ '--orb': orbit.color } as React.CSSProperties}>
          {orbit.name}
        </div>
      </Html>
    </group>
  );
}
