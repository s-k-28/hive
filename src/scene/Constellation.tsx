/**
 * The memory constellation. A single THREE.Points cloud, MAX 2000 stars, one
 * draw call. Positions are pre-allocated once on a flattened sphere shell and
 * never reallocated; the visible count grows via geometry.setDrawRange driven
 * by the store's memoryCount, so each stored memory ignites a new star
 * (signature animation #3). Stars twinkle by mutating their color buffer to HDR
 * values so they bloom.
 *
 * Recall threads (memory_recalled) draw light lines from random lit stars to
 * the recalling agent; they mount reactively off fx.recallThreads and fade out.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { AgentName } from '../lib/types';
import { useSwarm } from '../state/swarm';
import { orbitFor, orbitPosition } from './layout';

const MAX_STARS = 2000;
const _agentPos = new THREE.Vector3();

interface StarField {
  positions: Float32Array;
  baseColors: Float32Array; // per-star hue, scaled to HDR each frame
  twinkle: Float32Array; // per-star phase
}

function buildField(): StarField {
  const positions = new Float32Array(MAX_STARS * 3);
  const baseColors = new Float32Array(MAX_STARS * 3);
  const twinkle = new Float32Array(MAX_STARS);
  const c = new THREE.Color();
  for (let i = 0; i < MAX_STARS; i++) {
    // Flattened sphere shell, radius 18..40, y squashed.
    const r = 18 + Math.random() * 22;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    // Hue drifts gold -> cyan across the field for a swarm-memory feel.
    const h = 0.52 + Math.random() * 0.08 - (i / MAX_STARS) * 0.06;
    c.setHSL(h, 0.7, 0.6);
    baseColors[i * 3 + 0] = c.r;
    baseColors[i * 3 + 1] = c.g;
    baseColors[i * 3 + 2] = c.b;
    twinkle[i] = Math.random() * Math.PI * 2;
  }
  return { positions, baseColors, twinkle };
}

export function Constellation() {
  const points = useRef<THREE.Points>(null);
  const field = useMemo(() => buildField(), []);

  // Live color buffer the material reads; mutated each frame for twinkle.
  const colorAttr = useMemo(
    () => new THREE.BufferAttribute(new Float32Array(MAX_STARS * 3), 3),
    [],
  );
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    g.setAttribute('color', colorAttr);
    g.setDrawRange(0, 0);
    return g;
  }, [field, colorAttr]);

  // Smoothed visible-star count so growth eases instead of snapping.
  const shown = useRef(0);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const target = Math.min(useSwarm.getState().memoryCount, MAX_STARS);
    // Ease the draw range up; new stars ignite bright then settle (handled by
    // the twinkle term keyed on how close a star is to the growing frontier).
    shown.current += (target - shown.current) * Math.min(1, dt * 4);
    const n = Math.min(MAX_STARS, Math.ceil(shown.current));
    geometry.setDrawRange(0, n);

    const arr = colorAttr.array as Float32Array;
    const frontier = shown.current;
    for (let i = 0; i < n; i++) {
      // Base twinkle 1.6..2.2 (HDR so it blooms).
      let k = 1.6 + 0.3 * (1 + Math.sin(t * 1.5 + field.twinkle[i]));
      // Ignition flare for the newest star(s) near the frontier.
      const dist = frontier - i;
      if (dist >= 0 && dist < 1) k += (1 - dist) * 3.5;
      arr[i * 3 + 0] = field.baseColors[i * 3 + 0] * k;
      arr[i * 3 + 1] = field.baseColors[i * 3 + 1] * k;
      arr[i * 3 + 2] = field.baseColors[i * 3 + 2] * k;
    }
    colorAttr.needsUpdate = true;

    if (points.current) points.current.rotation.y = t * 0.012;
  });

  return (
    <group>
      <points ref={points} geometry={geometry} frustumCulled={false}>
        <pointsMaterial
          size={0.13}
          vertexColors
          toneMapped={false}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <RecallThreads field={field} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// memory_recalled -> light threads from constellation stars to the agent orb.

function RecallThreads({ field }: { field: StarField }) {
  const threads = useSwarm((s) => s.fx.recallThreads);
  return (
    <>
      {threads.map((th) => (
        <RecallThread
          key={`${th.agent}-${th.at}`}
          agent={th.agent}
          count={th.count}
          seed={th.at}
          field={field}
        />
      ))}
    </>
  );
}

function RecallThread({
  agent,
  count,
  seed,
  field,
}: {
  agent: AgentName;
  count: number;
  seed: number;
  field: StarField;
}) {
  const born = useRef<number | null>(null);
  const orbit = useMemo(() => orbitFor(agent), [agent]);

  // Pick a few star anchors deterministically from the event timestamp (no
  // Math.random in render), so the threads are stable for this recall.
  const anchors = useMemo(() => {
    const n = Math.max(1, Math.min(count, 4));
    const out: THREE.Vector3[] = [];
    let h = Math.floor(seed) % 600;
    for (let i = 0; i < n; i++) {
      h = (h * 137 + 53) % 600; // cheap LCG over the dense inner shell
      out.push(new THREE.Vector3(
        field.positions[h * 3 + 0],
        field.positions[h * 3 + 1],
        field.positions[h * 3 + 2],
      ));
    }
    return out;
  }, [count, seed, field]);

  // One persistent THREE.LineSegments: 2 verts per anchor, updated in place.
  const { obj, geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(anchors.length * 2 * 3), 3));
    const m = new THREE.LineBasicMaterial({
      color: new THREE.Color('#cdd7ea').multiplyScalar(2.4),
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const o = new THREE.LineSegments(g, m);
    o.frustumCulled = false;
    return { obj: o, geo: g, mat: m };
  }, [anchors.length]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    const age = (t - born.current) / 2.2; // lifetime, seconds
    if (orbit) orbitPosition(orbit, t, _agentPos);
    else _agentPos.set(0, 0, 0);

    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      attr.setXYZ(i * 2 + 0, a.x, a.y, a.z);
      attr.setXYZ(i * 2 + 1, _agentPos.x, _agentPos.y, _agentPos.z);
    }
    attr.needsUpdate = true;
    // Fade in then out across the thread lifetime.
    mat.opacity = age >= 1 ? 0 : Math.sin(Math.min(age, 1) * Math.PI) * 0.8;
    obj.visible = age < 1;
  });

  return <primitive object={obj} />;
}
