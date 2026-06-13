import type { AgentName, AgentRole, MissionStatus } from '../lib/types';
import { AGENT_ROSTER, ROLE_COLORS } from '../lib/types';

/**
 * Presentation helpers shared across overlay zones. Pure lookups derived from
 * the protocol tables in lib/types so the overlay never hard-codes a roster.
 */

const ROLE_BY_NAME: Record<AgentName, AgentRole> = Object.fromEntries(
  AGENT_ROSTER.map((a) => [a.name, a.role]),
) as Record<AgentName, AgentRole>;

/** Role for an agent name, or null for system lines (agent === null). */
export function roleOf(name: AgentName | null): AgentRole | null {
  return name ? ROLE_BY_NAME[name] : null;
}

/** Brand color for an agent name. Falls back to dim ink for system lines. */
export function colorOf(name: AgentName | null): string {
  const role = roleOf(name);
  return role ? ROLE_COLORS[role] : 'var(--ink-dim)';
}

/** Human label for an agent name in the log (system lines read "swarm"). */
export function labelOf(name: AgentName | null): string {
  return name ?? 'swarm';
}

export interface StatusMeta {
  label: string;
  /** CSS color token reference for the status pill accent. */
  tone: string;
}

/** Copy and accent color for each mission status pill. */
export const MISSION_STATUS_META: Record<MissionStatus, StatusMeta> = {
  planning: { label: 'Planning', tone: 'var(--gold)' },
  running: { label: 'Running', tone: 'var(--cyan)' },
  assembling: { label: 'Assembling', tone: 'var(--green)' },
  complete: { label: 'Complete', tone: 'var(--green)' },
  failed: { label: 'Failed', tone: 'var(--red)' },
  paused: { label: 'Paused', tone: 'var(--gold)' },
  awaiting_input: { label: 'Awaiting you', tone: 'var(--magenta)' },
};
