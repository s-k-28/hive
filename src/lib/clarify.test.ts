import { describe, expect, it } from 'vitest';
import {
  heuristicQuestions,
  buildBrief,
  generateClarifyingQuestions,
  type ClarifyAnswer,
} from './clarify';
import type { RepoRef } from './types';

/**
 * The clarifier turns a raw goal into an aligned brief. These pin the heuristic
 * generator (repo-aware vs not), the brief builder (drops blanks), and that the
 * public generator falls back to heuristics with no backend configured.
 */

const REPO: RepoRef = { provider: 'github', fullName: 'me/app', ref: 'main' };

describe('heuristicQuestions', () => {
  it('always asks for the desired outcome and constraints', () => {
    const qs = heuristicQuestions('Plan a launch', null);
    const ids = qs.map((q) => q.id);
    expect(ids).toContain('outcome');
    expect(ids).toContain('constraints');
  });

  it('asks repo-focus questions when a repo is attached, audience when not', () => {
    const withRepo = heuristicQuestions('Improve things', REPO).map((q) => q.id);
    expect(withRepo).toContain('focus');
    expect(withRepo).toContain('mode');
    expect(withRepo).not.toContain('audience');

    const noRepo = heuristicQuestions('Improve things', null).map((q) => q.id);
    expect(noRepo).toContain('audience');
    expect(noRepo).not.toContain('focus');
  });

  it('asks about tone for writing goals and depth otherwise', () => {
    expect(heuristicQuestions('Draft a blog post', null).map((q) => q.id)).toContain('tone');
    expect(heuristicQuestions('Build a billing system', null).map((q) => q.id)).toContain('depth');
  });
});

describe('buildBrief', () => {
  it('returns just the goal when nothing is answered', () => {
    const answers: ClarifyAnswer[] = [{ question: 'Q', answer: '   ' }];
    expect(buildBrief('My goal', answers)).toBe('My goal');
  });

  it('appends answered clarifications and drops blanks', () => {
    const answers: ClarifyAnswer[] = [
      { question: 'Audience?', answer: 'developers' },
      { question: 'Tone?', answer: '' },
      { question: 'Length?', answer: 'short' },
    ];
    const brief = buildBrief('Write docs', answers);
    expect(brief).toContain('Write docs');
    expect(brief).toContain('Audience? -> developers');
    expect(brief).toContain('Length? -> short');
    expect(brief).not.toContain('Tone?');
  });
});

describe('generateClarifyingQuestions', () => {
  it('falls back to heuristics with no backend', async () => {
    const qs = await generateClarifyingQuestions('Plan a launch', null);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs[0]).toHaveProperty('question');
    expect(qs[0]).toHaveProperty('kind');
  });
});
