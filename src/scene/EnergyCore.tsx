/**
 * The mission core: a distorted molten icosahedron wrapped in a fresnel rim
 * shell, lit from inside, haloed with sparkles. It breathes with mission
 * activity, ignites on start, gutters on failure, and flashes on completion.
 *
 * All state is read transiently from the store inside useFrame. Nothing here
 * triggers a React re-render and nothing allocates per frame.
 */

import { useFrame, extend, type ThreeElement } from '@react-three/fiber';
import { MeshDistortMaterial, Sparkles, shaderMaterial } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { damp } from 'maath/easing';
import { useSwarm } from '../state/swarm';
import { CORE_POSITION } from './layout';

// Fresnel rim shell. Brightens at grazing angles; additive so it blooms.
const FresnelMaterial = shaderMaterial(
  { color: new THREE.Color(2.0, 1.2, 0.3), power: 2.6, strength: 1.0 },
  /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  /* glsl */ `
    uniform vec3 color;
    uniform float power;
    uniform float strength;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = pow(1.0 - abs(dot(vN, vV)), power);
      gl_FragColor = vec4(color * f * strength, f * strength);
    }
  `,
);

extend({ FresnelMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    fresnelMaterial: ThreeElement<typeof FresnelMaterial>;
  }
}

type FresnelImpl = THREE.ShaderMaterial & {
  color: THREE.Color;
  power: number;
  strength: number;
};
type DistortImpl = THREE.MeshPhysicalMaterial & { distort: number };

// Hoisted scratch + target colors, never reallocated in the frame loop.
const SHELL_HOT = new THREE.Color(2.0, 1.2, 0.3);
const SHELL_FAIL = new THREE.Color(0.6, 0.12, 0.05);
const CORE_HOT = new THREE.Color('#ffaa33');
const CORE_FAIL = new THREE.Color('#5a1a0a');
const _shellColor = new THREE.Color();
const _coreColor = new THREE.Color();

export function EnergyCore() {
  const coreMat = useRef<DistortImpl>(null);
  const shellMat = useRef<FresnelImpl>(null);
  const light = useRef<THREE.PointLight>(null);
  const group = useRef<THREE.Group>(null);

  // Smoothed activity drivers, kept across frames in a mutable ref bag.
  const drive = useRef({ ignite: 0, fail: 0, burst: 0, lastBurst: 0 });

  const sparkleColor = useMemo(() => new THREE.Color('#f5b94a'), []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const s = useSwarm.getState();
    const status = s.mission?.status ?? null;

    // Target activity: 0 when idle/no mission, 1 when a mission is live.
    const active = status === 'running' || status === 'planning' || status === 'assembling';
    const failed = status === 'failed';

    const d = drive.current;
    // Idle floor sits high enough that the dormant core still anchors the hero
    // shot before any mission starts. It lifts to 1 once a mission is live.
    damp(d, 'ignite', active ? 1 : status === 'complete' ? 0.85 : failed ? 0.25 : 0.6, 0.5, dt);
    damp(d, 'fail', failed ? 1 : 0, 0.6, dt);

    // One-shot completion burst, latched off the store's burstAt timestamp.
    const burstAt = s.fx.burstAt;
    if (burstAt != null && burstAt !== d.lastBurst) {
      d.lastBurst = burstAt;
      d.burst = 1;
    }
    damp(d, 'burst', 0, 0.7, dt);

    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    const fast = 0.5 + 0.5 * Math.sin(t * 4.0);

    // Core: molten icosahedron. Emissive rides activity + a slow breath, then
    // spikes hard on the completion burst.
    if (coreMat.current) {
      const m = coreMat.current;
      const baseEmissive = 1.4 + d.ignite * (2.4 + pulse * 1.6) + d.burst * 9.0;
      damp(m, 'emissiveIntensity', baseEmissive, 0.15, dt);
      m.distort = 0.28 + d.ignite * 0.16 + fast * 0.05 * d.ignite + d.burst * 0.2;
      _coreColor.copy(CORE_HOT).lerp(CORE_FAIL, d.fail);
      m.emissive.copy(_coreColor);
    }

    // Shell: fresnel rim. Strength tracks activity; color guttering on failure.
    if (shellMat.current) {
      const m = shellMat.current;
      const targetStrength = 0.7 + d.ignite * (0.6 + pulse * 0.35) + d.burst * 2.5;
      damp(m, 'strength', targetStrength, 0.18, dt);
      _shellColor.copy(SHELL_HOT).lerp(SHELL_FAIL, d.fail);
      m.color.copy(_shellColor);
    }

    // Inner light spills onto the orbiting agents.
    if (light.current) {
      const targetIntensity = 8 + d.ignite * 18 + d.burst * 60;
      damp(light.current, 'intensity', targetIntensity, 0.15, dt);
      _coreColor.copy(CORE_HOT).lerp(CORE_FAIL, d.fail);
      light.current.color.copy(_coreColor);
    }

    // Whole assembly turns slowly, faster when ignited.
    if (group.current) {
      group.current.rotation.y += dt * (0.08 + d.ignite * 0.12);
    }
  });

  return (
    <group ref={group} position={CORE_POSITION}>
      <pointLight ref={light} intensity={8} distance={16} decay={2} color="#ffaa33" />

      {/* Molten inner core */}
      <mesh>
        <icosahedronGeometry args={[1.15, 6]} />
        <MeshDistortMaterial
          ref={coreMat as never}
          distort={0.3}
          speed={2.2}
          radius={1}
          color="#1a0d00"
          emissive="#ffaa33"
          emissiveIntensity={1.6}
          roughness={0.35}
          metalness={0.1}
          toneMapped={false}
        />
      </mesh>

      {/* Fresnel rim shell, rendered from the inside-out, additive */}
      <mesh scale={1.28}>
        <sphereGeometry args={[1.15, 48, 48]} />
        <fresnelMaterial
          ref={shellMat}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          color={[2.0, 1.2, 0.3]}
          power={2.6}
          strength={1}
        />
      </mesh>

      {/* Halo of embers around the core */}
      <Sparkles
        count={40}
        scale={4.2}
        size={3}
        speed={0.4}
        opacity={0.7}
        color={sparkleColor}
        noise={1}
      />
    </group>
  );
}
