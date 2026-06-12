import { createClient, type InsForgeClient } from '@insforge/sdk';

/**
 * The InsForge browser client, or null when no project is configured.
 *
 * When VITE_INSFORGE_URL and VITE_INSFORGE_ANON_KEY are set, the app runs in
 * live mode against a real InsForge project. When they are absent (local dev,
 * or the demo without a backend), getClient() returns null and the mission
 * launcher falls back to the local simulation. Both paths drive the exact same
 * event reducer, so the experience is identical.
 */

const baseUrl = import.meta.env.VITE_INSFORGE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

const client: InsForgeClient | null =
  baseUrl && anonKey ? createClient({ baseUrl, anonKey }) : null;

export function getClient(): InsForgeClient | null {
  return client;
}

/** True when a real InsForge project is wired (live mode). */
export const isLiveBackend = client !== null;
