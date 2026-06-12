/**
 * The single post-processing stack. One EffectComposer, multisampling off, per
 * the perf budget. Bloom is selective by threshold: only materials that exceed
 * HDR 1.0 with toneMapped=false bloom, so emissive intensities are the knob.
 */

import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Vector2 } from 'three';
import { useMemo } from 'react';

export function Effects() {
  // Hoisted: ChromaticAberration wants a stable Vector2 offset.
  const caOffset = useMemo(() => new Vector2(0.0008, 0.0008), []);

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        intensity={1.2}
        luminanceThreshold={1}
        luminanceSmoothing={0.6}
        levels={8}
      />
      <ChromaticAberration
        blendFunction={BlendFunction.NORMAL}
        offset={caOffset}
        radialModulation={false}
        modulationOffset={0}
      />
      <Vignette eskil={false} offset={0.15} darkness={0.9} />
    </EffectComposer>
  );
}
