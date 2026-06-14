import { getClient } from './insforge';
import type { RepoRef } from './types';

/**
 * Pre-launch clarification. Before a mission starts, HIVE asks the operator a
 * few sharp questions so the swarm builds exactly what they want. The answers
 * become the mission brief, fed in as `guidance` (which the planner and every
 * worker already honor), so alignment is baked in from the first tick.
 *
 * Questions come from an AI edge function when live (goal- and repo-aware); in
 * dev/offline they come from a heuristic generator so the flow is fully
 * demoable. Either way the answers are folded into one brief by buildBrief.
 */

export interface ClarifyQuestion {
  id: string;
  question: string;
  /** 'choice' shows quick-reply chips (custom text still allowed); 'text' is free-form. */
  kind: 'choice' | 'text';
  options?: string[];
  placeholder?: string;
}

export interface ClarifyAnswer {
  question: string;
  answer: string;
}

/** Generate clarifying questions for a goal. Live: the `clarify` edge function.
 *  Dev/offline or on any failure: the heuristic generator below. */
export async function generateClarifyingQuestions(
  goal: string,
  repo: RepoRef | null,
): Promise<ClarifyQuestion[]> {
  const client = getClient();
  if (client) {
    try {
      const res = await client.functions.invoke('clarify', { body: { goal, repo } });
      const data = (res as { data?: { questions?: ClarifyQuestion[] } }).data;
      const questions = data?.questions;
      if (Array.isArray(questions) && questions.length > 0) {
        return questions.slice(0, 6).map(normalizeQuestion);
      }
    } catch (e) {
      console.error('[hive] clarify function failed, using heuristics', e);
    }
  }
  return heuristicQuestions(goal, repo);
}

function normalizeQuestion(q: ClarifyQuestion, i: number): ClarifyQuestion {
  return {
    id: q.id || `q${i + 1}`,
    question: String(q.question ?? '').slice(0, 240),
    kind: q.kind === 'choice' ? 'choice' : 'text',
    options: Array.isArray(q.options) ? q.options.slice(0, 5).map((o) => String(o)) : undefined,
    placeholder: q.placeholder ? String(q.placeholder).slice(0, 80) : undefined,
  };
}

/** Deterministic, goal-aware questions for offline mode and as the live
 *  fallback. Tailored by whether a repo is attached and a few goal cues. */
export function heuristicQuestions(goal: string, repo: RepoRef | null): ClarifyQuestion[] {
  const g = goal.toLowerCase();
  const qs: ClarifyQuestion[] = [];

  qs.push({
    id: 'outcome',
    question: 'In one sentence, what does a great result look like for this?',
    kind: 'text',
    placeholder: 'The single outcome that would make this a win',
  });

  if (repo) {
    qs.push({
      id: 'focus',
      question: `Which part of ${repo.fullName} should the swarm focus on?`,
      kind: 'text',
      placeholder: 'e.g. the auth flow, the API layer, the whole repo',
    });
    qs.push({
      id: 'mode',
      question: 'What kind of work is this, mainly?',
      kind: 'choice',
      options: ['Analysis / review', 'Plan a change', 'Write documentation', 'Design an approach'],
    });
  } else {
    qs.push({
      id: 'audience',
      question: 'Who is this for? Describe the audience or reader.',
      kind: 'text',
      placeholder: 'e.g. senior engineers, indie founders, end users',
    });
  }

  if (/(write|draft|blog|copy|post|readme|doc)/.test(g)) {
    qs.push({
      id: 'tone',
      question: 'What tone should it strike?',
      kind: 'choice',
      options: ['Technical & precise', 'Friendly & plain', 'Bold & punchy', 'Formal'],
    });
  } else {
    qs.push({
      id: 'depth',
      question: 'How deep should it go?',
      kind: 'choice',
      options: ['Quick & high-level', 'Balanced', 'Thorough & detailed'],
    });
  }

  qs.push({
    id: 'constraints',
    question: 'Any must-haves or things to avoid? (constraints, length, tech, no-gos)',
    kind: 'text',
    placeholder: 'Anything the swarm must respect — or steer clear of',
  });

  return qs;
}

/** Fold the goal + answered questions into one brief, used as mission guidance.
 *  Unanswered questions are dropped so blanks never become noise. */
export function buildBrief(goal: string, answers: ClarifyAnswer[]): string {
  const answered = answers.filter((a) => a.answer.trim().length > 0);
  if (answered.length === 0) return goal.trim();
  const lines = answered.map((a) => `- ${a.question.trim()} -> ${a.answer.trim()}`);
  return (
    `${goal.trim()}\n\n` +
    `Clarifications from the operator (honor these exactly):\n${lines.join('\n')}`
  );
}
