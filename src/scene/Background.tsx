/**
 * Deep-space backdrop: a large inverted sphere with a subtle radial gradient
 * from a faint core glow to the page background, plus exponential fog so distant
 * constellation stars fall off into the dark. All values stay below HDR 1.0 so
 * the backdrop itself never blooms.
 */

import { extend, type ThreeElement } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { BackSide, Color } from 'three';

const BackdropMaterial = shaderMaterial(
  {
    inner: new Color('#0b1326'),
    outer: new Color('#05070f'),
  },
  /* glsl */ `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  /* glsl */ `
    uniform vec3 inner;
    uniform vec3 outer;
    varying vec3 vPos;
    void main() {
      // Vertical-biased radial gradient centered on the core.
      float d = clamp(length(vPos) / 60.0, 0.0, 1.0);
      float v = clamp(vPos.y / 60.0 + 0.5, 0.0, 1.0);
      vec3 col = mix(inner, outer, smoothstep(0.0, 1.0, d * 0.7 + (1.0 - v) * 0.3));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
);

extend({ BackdropMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    backdropMaterial: ThreeElement<typeof BackdropMaterial>;
  }
}

export function Background() {
  return (
    <>
      <fogExp2 attach="fog" args={['#05070f', 0.018]} />
      <mesh scale={70}>
        <sphereGeometry args={[1, 32, 32]} />
        <backdropMaterial side={BackSide} depthWrite={false} fog={false} />
      </mesh>
    </>
  );
}
