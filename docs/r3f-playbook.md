# R3F playbook for the Hive scene (verified June 2026)

Produced by recon against npm registry and pmndrs docs. Binding for all scene work.

## 1. Package matrix (already installed, do not bump)

- react 19.2.x, three **0.184.0 exactly** (postprocessing 6.39.1 caps three at <0.185.0), @react-three/fiber 9.6.1, @react-three/drei 10.7.7, @react-three/postprocessing 3.0.4, zustand 5.x.
- drei bundles camera-controls and troika-three-text; do not install separately. maath comes via drei (`maath/easing`).
- Do not use the r3f v10 branch.

## 2. Selective bloom recipe (threshold approach, NOT <SelectiveBloom>)

`Bloom` is selective by default when materials exceed HDR 1.0 and `luminanceThreshold={1}`.

```jsx
<Canvas dpr={[1, 1.5]} gl={{ antialias: false }} camera={{ position: [0, 4, 14], fov: 45 }}>
  {/* scene */}
  <EffectComposer multisampling={0}>
    <Bloom mipmapBlur intensity={1.2} luminanceThreshold={1} levels={7} />
    <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.0008, 0.0008]} />
    <Vignette eskil={false} offset={0.15} darkness={0.9} />
  </EffectComposer>
</Canvas>
```

Glowing materials: `<meshStandardMaterial emissive="#22d3ee" emissiveIntensity={3} toneMapped={false} color="#000" />` or `<meshBasicMaterial color={[0, 2.5, 3]} toneMapped={false} />`. State-driven glow = animate `emissiveIntensity` per frame (idle 1.5, thinking pulse 2 to 6 with sin, complete spike 12 and decay, error swap emissive to #ff2244 and spike). `mipmapBlur` mandatory, `levels` 7-9 for the wide cinematic halo.

## 3. Particles along curves (data-flow beams)

CPU sample `CatmullRomCurve3` into an `InstancedMesh`, N particles per edge with random phase offsets, advance t in `useFrame` using `curve.getPointAt(u)` (arc-length uniform). Arc the mid control point upward by `0.35 * distance`. Fade scale at endpoints with `sin(u * PI)`. Particle material: `meshBasicMaterial` with color multiplied >1, `toneMapped={false}`. Static beam underneath: drei `<Line>` or TubeGeometry with low-opacity additive material, color >1 so it blooms faintly. One InstancedMesh per edge is fine up to ~50 edges.

```jsx
function FlowEdge({ start, end, color = '#22d3ee', count = 24, speed = 0.35 }) {
  const ref = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const curve = useMemo(() => {
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    mid.y += start.distanceTo(end) * 0.35
    return new THREE.CatmullRomCurve3([start, mid, end])
  }, [start, end])
  const offsets = useMemo(() => Float32Array.from({ length: count }, () => Math.random()), [count])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed
    for (let i = 0; i < count; i++) {
      const u = (t + offsets[i]) % 1
      curve.getPointAt(u, dummy.position)
      const s = 0.5 + 0.5 * Math.sin(u * Math.PI)
      dummy.scale.setScalar(0.04 * s)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color={new THREE.Color(color).multiplyScalar(3)} toneMapped={false} />
    </instancedMesh>
  )
}
```

## 4. Constellation (2000 points, 1 draw call)

THREE.Points with pre-allocated Float32Array buffers (MAX 2000), grow via `geometry.setDrawRange(0, n)`, never reallocate. Per-point twinkle by mutating the color buffer each frame (HDR values 1.6 to 2.2 so it blooms), `needsUpdate = true`. Material: `pointsMaterial size={0.12} vertexColors toneMapped={false} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending}`. Distribute on a flattened sphere shell r 18-40, y squashed 0.6. The 2000-iteration loop per frame costs <0.1ms.

## 5. State-driven animation, zero React re-renders

Zustand transient pattern: realtime events mutate the store; scene components read `useSwarm.getState()` inside `useFrame` via refs. Only the HTML overlay uses reactive selector hooks. Rules: never setState from useFrame, never create Vector3/Color/Object3D inside useFrame (hoist or useMemo), mount the full agent roster up front and toggle `visible`. Use `maath/easing` damp/damp3/dampC for framerate-independent lerps, e.g. `THREE.MathUtils.damp(mat.emissiveIntensity, target, 8, dt)`.

## 6. Camera

drei `<CameraControls>` (yomotsu v3). Idle orbit: `ref.current.azimuthAngle += dt * 0.05` in useFrame when not focused. Click-to-focus: `setLookAt(px+2.5, py+1.2, pz+2.5, px, py, pz, true)` which smooth-damps (smoothTime 0.6). Unfocus returns to (0,4,14) looking at origin. `setLookAt` returns a promise for sequencing. Store the focus target in zustand, not window. For video recording, a scripted async tour chaining setLookAt calls.

## 7. Energy core (premium, minimal GLSL)

1. Inner core: icosahedron + drei `MeshDistortMaterial` `distort={0.35} speed={2} emissive="#ffaa33" emissiveIntensity={4} toneMapped={false} color="#000"`, pulse distort and intensity with sin.
2. Fresnel rim shell: slightly larger sphere, BackSide, additive, via drei `shaderMaterial`:

```js
const FresnelMat = shaderMaterial(
  { color: new THREE.Color(2.0, 1.2, 0.3), power: 3.0 },
  `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  `uniform vec3 color; uniform float power; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0 - abs(dot(vN, vV)), power); gl_FragColor = vec4(color * f, f); }`
)
```

3. Billboard halo sprite or Sparkles ring.
4. PointLight inside the core (`intensity={20} distance={15} decay={2}`) so the core illuminates orbiting agents. This detail makes it cinematic.
5. Agent orbits: `position.set(cos(t*w+phi)*r, sin(t*0.5+phi)*0.4, sin(t*w+phi)*r)` with unique radius/phase/inclination per agent.

## 8. 60fps budget (hard limits)

- `dpr={[1, 1.5]}`, `gl={{ antialias: false }}`, EffectComposer `multisampling={0}`. One composer only. Bloom + aberration + vignette only (no SSAO, no DoF).
- Draw call budget <150 (we should land ~70). No shadows anywhere. Lights: 1 ambient + core point light + max 1 accent.
- `frustumCulled={false}` on instanced/points meshes. `frameloop="always"`.
- Pre-warm shaders before recording (render frames or `gl.compile`). Record plugged into power.

## 9. Text rules

- Mission log, input, auth, progress: plain DOM overlay positioned absolutely over the Canvas, `pointer-events: none` on the wrapper, `auto` on interactive children. Glassmorphism: `backdrop-filter: blur(16px); background: rgba(10,15,30,.45); border: 1px solid rgba(255,255,255,.12)`.
- Agent labels: drei `<Html center distanceFactor={10}>` chips, pointer-events none, max ~10.
- In-world etched text only: drei `<Text>` (troika SDF).

## 10. Reference examples

- pmndrs examples: https://r3f.docs.pmnd.rs/getting-started/examples
- Maxime Heckel particles deep-dive: https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/
- wawa-vfx particle emitter: https://wawasensei.dev/blog/wawa-vfx-open-source-particle-system-for-react-three-fiber-projects
- Shader galaxy: https://github.com/sugaith/react-three-fiber-shader-galaxy
- Emissive bloom minimal example: https://onion2k.github.io/r3f-by-example/
- camera-controls cookbook: https://yomotsu.github.io/camera-controls/

## Build order

Canvas + composer + dpr clamp first (lock the look), then core, agents with state machine, constellation, edges/particles, camera rig, overlay, and tune emissive values last (they interact with the bloom threshold globally).
