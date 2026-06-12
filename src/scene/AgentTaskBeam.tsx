/**
 * Beam from an agent orb to the task it has claimed. The agent endpoint moves
 * every frame (the orb is orbiting), so unlike the static FlowEdge this samples
 * a fresh curve each frame by mutating three reused control points in place. No
 * geometry is rebuilt; the line buffer and instance matrices are updated.
 *
 * The agent end is recomputed from the same orbit math the orb uses, so the
 * beam stays glued to the orb without reading its transform.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { damp } from 'maath/easing';
import type { AgentName } from '../lib/types';
import { orbitFor, orbitPosition } from './layout';

const LINE_SEGMENTS = 20;
const _p = new THREE.Vector3();

interface AgentTaskBeamProps {
  agent: AgentName;
  target: THREE.Vector3;
  color: string;
  count?: number;
  speed?: number;
  /** Transient gate read inside useFrame; no re-render on change. */
  isLive?: () => boolean;
}

export function AgentTaskBeam({
  agent,
  target,
  color,
  count = 18,
  speed = 0.5,
  isLive,
}: AgentTaskBeamProps) {
  const orbit = useMemo(() => orbitFor(agent), [agent]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  const drive = useRef({ flow: 0 });

  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const particleColor = useMemo(() => new THREE.Color(color).multiplyScalar(3), [color]);

  // Persistent, per-frame-mutated objects live in refs (not memo) because they
  // are long-lived mutable instances, which is exactly what refs are for. Built
  // lazily on first access; construction is pure (no random/time).
  const dummy = useRef<THREE.Object3D>(null);
  dummy.current ??= new THREE.Object3D();

  const curve = useRef<THREE.CatmullRomCurve3>(null);
  curve.current ??= new THREE.CatmullRomCurve3([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);

  // The static beam: one persistent THREE.Line with its own geometry/material.
  const lineRef = useRef<{
    obj: THREE.Line;
    geo: THREE.BufferGeometry;
    mat: THREE.LineBasicMaterial;
  }>(null);
  if (lineRef.current === null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LINE_SEGMENTS + 1) * 3), 3));
    const m = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.2,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const obj = new THREE.Line(g, m);
    obj.visible = false;
    obj.frustumCulled = false;
    lineRef.current = { obj, geo: g, mat: m };
  }

  // Deterministic phase spread (no Math.random in render).
  const offsets = useMemo(
    () => Float32Array.from({ length: count }, (_, i) => (i * 0.61803398875) % 1),
    [count],
  );

  useFrame((state, dt) => {
    const d = drive.current;
    const live = isLive ? isLive() : false;
    damp(d, 'flow', live ? 1 : 0, 0.25, dt);

    if (!orbit) return;
    const t = state.clock.elapsedTime;
    const crv = curve.current!;
    const dum = dummy.current!;
    const ln = lineRef.current!;

    // Agent endpoint from orbit math; midpoint arced upward.
    orbitPosition(orbit, t, crv.points[0]);
    crv.points[2].copy(target);
    crv.points[1].addVectors(crv.points[0], crv.points[2]).multiplyScalar(0.5);
    crv.points[1].y += crv.points[0].distanceTo(crv.points[2]) * 0.28;

    // Rewrite the static line buffer.
    const visible = d.flow > 0.02;
    ln.obj.visible = visible;
    if (visible) {
      const attr = ln.geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= LINE_SEGMENTS; i++) {
        crv.getPoint(i / LINE_SEGMENTS, _p);
        attr.setXYZ(i, _p.x, _p.y, _p.z);
      }
      attr.needsUpdate = true;
    }
    ln.mat.color.copy(baseColor).multiplyScalar(0.6 + d.flow * 2.4);
    ln.mat.opacity = 0.2 + d.flow * 0.5;

    if (!mesh.current) return;
    if (d.flow < 0.02) {
      mesh.current.visible = false;
      return;
    }
    mesh.current.visible = true;
    const tt = t * speed;
    for (let i = 0; i < count; i++) {
      const u = (tt + offsets[i]) % 1;
      crv.getPoint(u, _p);
      dum.position.copy(_p);
      const fade = 0.5 + 0.5 * Math.sin(u * Math.PI);
      dum.scale.setScalar(0.05 * fade * d.flow);
      dum.updateMatrix();
      mesh.current.setMatrixAt(i, dum.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <primitive object={lineRef.current.obj} />
      <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} visible={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={particleColor} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
