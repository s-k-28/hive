/**
 * The task DAG. Structural changes (which tasks and edges exist) come from a
 * reactive selector so nodes mount when plan_created lands; per-node visuals
 * (status color, pulse, the bloom-in scale) animate transiently in useFrame.
 *
 * Signature animation #1: when the plan arrives the nodes materialize with a
 * staggered scale-in driven by each node's own mount time. Liveness of edges
 * is read transiently inside the edge components (isLive callbacks), so an
 * agent thinking or a task running never re-renders this tree.
 */

import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { damp, dampC } from 'maath/easing';
import type { AgentName, Task } from '../lib/types';
import { ROLE_COLORS } from '../lib/types';
import { useSwarm } from '../state/swarm';
import { FlowEdge } from './FlowEdge';
import { AgentTaskBeam } from './AgentTaskBeam';
import { layoutTasks, orbitFor, orbitPosition, taskStatusColor, type TaskLayout } from './layout';

const _target = new THREE.Color();
const _critic = new THREE.Vector3();

// ---------------------------------------------------------------------------

interface TaskNodeProps {
  task: Task;
  layout: TaskLayout;
  index: number;
}

function TaskNode({ task, layout, index }: TaskNodeProps) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const group = useRef<THREE.Group>(null);
  // Staggered bloom-in: birth captured on the first frame (no impure now() in
  // render), then offset per sibling so they cascade in.
  const born = useRef<number | null>(null);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t + (index * 90) / 1000;
    const rt = useSwarm.getState().tasks[task.id];
    const status = rt?.status ?? task.status;

    // Bloom-in scale: ease 0 -> 1 over ~0.6s after this node's birth, with a
    // small overshoot so it pops.
    if (group.current) {
      const age = (t - born.current) / 0.6;
      const k = age <= 0 ? 0 : age >= 1 ? 1 : 1 - Math.pow(1 - age, 3);
      const overshoot = age > 0 && age < 1 ? Math.sin(age * Math.PI) * 0.12 : 0;
      group.current.scale.setScalar(k + overshoot);
      group.current.visible = age > 0;
    }

    if (!mat.current) return;

    // Gate hold: the gated task node pulses amber while the swarm awaits a
    // decision, overriding its status color so the eye goes straight to it.
    const gate = useSwarm.getState().gate;
    const gated = gate?.kind === 'risk' && gate.taskId === task.id;
    if (gated) {
      const amber = 0.5 + 0.5 * Math.sin(t * 4.5);
      _target.set('#f5b94a');
      dampC(mat.current.emissive, _target, 0.1, dt);
      mat.current.color.copy(_target);
      damp(mat.current, 'emissiveIntensity', 3 + amber * 4, 0.1, dt);
      return;
    }

    _target.set(taskStatusColor(status));
    dampC(mat.current.emissive, _target, 0.12, dt);
    mat.current.color.copy(_target);

    const pulse = 0.5 + 0.5 * Math.sin(t * 3.0 + index);
    let glow: number;
    switch (status) {
      case 'running':
        glow = 2.4 + pulse * 2.4;
        break;
      case 'rejected':
        glow = 3 + pulse * 3;
        break;
      case 'review':
        glow = 2.2 + pulse * 0.8;
        break;
      case 'accepted':
        glow = 3.2;
        break;
      case 'failed':
        glow = 1.6;
        break;
      case 'killed':
        glow = 0.3; // dimmed out, terminal
        break;
      default:
        glow = 0.6 + pulse * 0.2; // pending, dim
    }
    damp(mat.current, 'emissiveIntensity', glow, 0.14, dt);
  });

  return (
    <group ref={group} position={layout.position} visible={false}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          useSwarm.getState().setFocusTask(task.id);
        }}
      >
        <octahedronGeometry args={[0.42, 0]} />
        <meshStandardMaterial
          ref={mat}
          color="#3b4a66"
          emissive="#3b4a66"
          emissiveIntensity={0.6}
          roughness={0.25}
          metalness={0.3}
          flatShading
          toneMapped={false}
        />
      </mesh>
      <Billboard position={[0, -0.74, 0]}>
        <Text
          fontSize={0.2}
          maxWidth={2.8}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          color="#cdd7ea"
          outlineWidth={0.006}
          outlineColor="#05070f"
        >
          {task.title}
        </Text>
      </Billboard>
    </group>
  );
}

// ---------------------------------------------------------------------------

export function TaskGraph() {
  // Reactive: structure (which tasks/edges exist) drives mounting only.
  const tasks = useSwarm((s) => s.tasks);

  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const layout = useMemo(() => layoutTasks(taskList), [taskList]);

  // Static dependency edges: dependency -> child. Stable per task set.
  const depEdges = useMemo(() => {
    const edges: { id: string; from: THREE.Vector3; to: THREE.Vector3; childId: string }[] = [];
    for (const task of taskList) {
      const a = layout.get(task.id);
      if (!a) continue;
      for (const dep of task.dependsOn) {
        const b = layout.get(dep);
        if (b) edges.push({ id: `${dep}->${task.id}`, from: b.position, to: a.position, childId: task.id });
      }
    }
    return edges;
  }, [taskList, layout]);

  // Agent -> claimed task beams: any task that currently has an assignee.
  const claimEdges = useMemo(() => {
    const edges: { id: string; agent: AgentName; target: THREE.Vector3; color: string }[] = [];
    for (const task of taskList) {
      const l = layout.get(task.id);
      if (!l || !task.assignee) continue;
      const orbit = orbitFor(task.assignee);
      edges.push({
        id: `${task.assignee}->${task.id}`,
        agent: task.assignee,
        target: l.position,
        color: orbit?.color ?? ROLE_COLORS.worker,
      });
    }
    return edges;
  }, [taskList, layout]);

  return (
    <group>
      {taskList.map((task, i) => {
        const l = layout.get(task.id);
        return l ? <TaskNode key={task.id} task={task} layout={l} index={i} /> : null;
      })}

      {depEdges.map((e) => (
        <FlowEdge
          key={e.id}
          start={e.from}
          end={e.to}
          color="#4a5d80"
          count={16}
          isLive={() => useSwarm.getState().tasks[e.childId]?.status === 'running'}
        />
      ))}

      {claimEdges.map((e) => (
        <AgentTaskBeam
          key={e.id}
          agent={e.agent}
          target={e.target}
          color={e.color}
          isLive={() => useSwarm.getState().agents[e.agent]?.visual === 'thinking'}
        />
      ))}

      <RejectPulses layout={layout} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Reject pulses: a red bolt travelling from the critic orb to the bounced node.
// Reactive on the pulse list so a bolt mounts when one arrives; pruneFx clears
// stale entries which unmounts them.

function RejectPulses({ layout }: { layout: Map<string, TaskLayout> }) {
  const pulses = useSwarm((s) => s.fx.rejectPulses);
  return (
    <>
      {pulses.map((p) => {
        const l = layout.get(p.taskId);
        return l ? <RejectBolt key={`${p.taskId}-${p.at}`} target={l.position} /> : null;
      })}
    </>
  );
}

function RejectBolt({ target }: { target: THREE.Vector3 }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const born = useRef<number | null>(null);
  const orbit = useMemo(() => orbitFor('critic'), []);
  const boltColor = useMemo(() => new THREE.Color('#ff2244').multiplyScalar(3.2), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    const age = (t - born.current) / 0.9; // travel time, seconds
    if (!mesh.current || !mat.current) return;
    if (age >= 1) {
      mesh.current.visible = false;
      return;
    }
    mesh.current.visible = true;
    if (orbit) orbitPosition(orbit, t, _critic);
    else _critic.set(0, 0, 0);
    mesh.current.position.lerpVectors(_critic, target, age);
    const fade = Math.sin(age * Math.PI);
    mesh.current.scale.setScalar(0.12 + fade * 0.1);
    mat.current.opacity = fade;
  });

  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial
        ref={mat}
        color={boltColor}
        transparent
        opacity={0}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
