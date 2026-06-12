/**
 * A data-flow beam. A faint static tube underneath, plus N particles riding a
 * CatmullRomCurve3 from start to end. Particles only animate (and the beam only
 * brightens) while `live` is true, so an edge reads as "carrying work" exactly
 * when its agent is thinking or its task is running.
 *
 * Endpoints are passed as Vector3s; the curve is rebuilt only when they move.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { damp } from 'maath/easing';

const _scratch = new THREE.Vector3();

interface FlowEdgeProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color?: string;
  count?: number;
  speed?: number;
  /** Optional transient gate read inside useFrame; no re-render on change. */
  isLive?: () => boolean;
  /** lift of the arc midpoint as a fraction of the span */
  arc?: number;
}

export function FlowEdge({
  start,
  end,
  color = '#22d3ee',
  count = 22,
  speed = 0.35,
  isLive,
  arc = 0.32,
}: FlowEdgeProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tubeMat = useRef<THREE.MeshBasicMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drive = useRef({ flow: 0 });

  // Curve + tube geometry rebuild only when endpoints change identity/value.
  const curve = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * arc;
    return new THREE.CatmullRomCurve3([start.clone(), mid, end.clone()]);
  }, [start, end, arc]);

  const tubeGeo = useMemo(() => new THREE.TubeGeometry(curve, 24, 0.012, 6, false), [curve]);

  // Deterministic phase spread (no Math.random in render): an irrational step
  // gives an even, non-banded distribution of particles along the curve.
  const offsets = useMemo(
    () => Float32Array.from({ length: count }, (_, i) => (i * 0.61803398875) % 1),
    [count],
  );

  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const particleColor = useMemo(() => new THREE.Color(color).multiplyScalar(3), [color]);

  useFrame((state, dt) => {
    const d = drive.current;
    const live = isLive ? isLive() : false;
    damp(d, 'flow', live ? 1 : 0, 0.25, dt);

    // Tube glow: faint always, brighter while live so it blooms.
    if (tubeMat.current) {
      const k = 0.5 + d.flow * 2.6;
      tubeMat.current.color.copy(baseColor).multiplyScalar(k);
      tubeMat.current.opacity = 0.18 + d.flow * 0.5;
    }

    if (!mesh.current) return;
    if (d.flow < 0.02) {
      mesh.current.visible = false;
      return;
    }
    mesh.current.visible = true;

    const t = state.clock.elapsedTime * speed;
    for (let i = 0; i < count; i++) {
      const u = (t + offsets[i]) % 1;
      curve.getPointAt(u, _scratch);
      dummy.position.copy(_scratch);
      const fade = 0.5 + 0.5 * Math.sin(u * Math.PI);
      dummy.scale.setScalar(0.045 * fade * d.flow);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={tubeGeo}>
        <meshBasicMaterial
          ref={tubeMat}
          color={baseColor}
          transparent
          opacity={0.18}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} visible={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={particleColor} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
