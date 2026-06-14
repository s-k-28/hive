import { create } from 'zustand';

/**
 * Conversation state for the chat-driven deck. The operator messages tasks
 * continuously; each message spawns a swarm mission, and the thread carries
 * context forward (woven into each new mission's guidance) so HIVE behaves like
 * an ongoing, governable agent session rather than one-shot runs.
 */

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string; // user's message
  goal?: string; // assistant: the goal the swarm is running
  missionId?: string; // assistant: linked mission
  status?: string; // assistant: snapshotted terminal status
  result?: string | null; // assistant: the delivered artifact markdown
  artifactName?: string | null;
  artifactUrl?: string | null;
  createdAt: number;
}

interface ConversationState {
  turns: ChatTurn[];
  addUser: (text: string) => void;
  addAssistant: (missionId: string, goal: string) => void;
  patchAssistant: (missionId: string, patch: Partial<ChatTurn>) => void;
  /** Weave the recent conversation into guidance for the next mission. */
  buildGuidance: () => string | null;
  reset: () => void;
}

const uid = (): string =>
  globalThis.crypto && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : `t-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export const useConversation = create<ConversationState>((set, get) => ({
  turns: [],

  addUser: (text) =>
    set((s) => ({
      turns: [...s.turns, { id: uid(), role: 'user', text, createdAt: Date.now() }],
    })),

  addAssistant: (missionId, goal) =>
    set((s) => ({
      turns: [
        ...s.turns,
        { id: uid(), role: 'assistant', text: '', goal, missionId, status: 'planning', createdAt: Date.now() },
      ],
    })),

  patchAssistant: (missionId, patch) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.role === 'assistant' && t.missionId === missionId ? { ...t, ...patch } : t,
      ),
    })),

  buildGuidance: () => {
    const turns = get().turns;
    if (turns.length === 0) return null;
    const lines: string[] = [];
    for (const t of turns.slice(-8)) {
      if (t.role === 'user') {
        lines.push(`The operator asked: ${t.text}`);
      } else if (t.result) {
        lines.push(`You delivered "${t.artifactName ?? 'a result'}": ${t.result.replace(/\s+/g, ' ').slice(0, 360)}`);
      } else if (t.goal) {
        lines.push(`You worked on: ${t.goal}`);
      }
    }
    if (lines.length === 0) return null;
    return (
      'This is an ongoing session with the same operator. Earlier context:\n' +
      lines.join('\n') +
      '\nWhen the new goal relates to the above, build on it and stay consistent.'
    );
  },

  reset: () => set({ turns: [] }),
}));
