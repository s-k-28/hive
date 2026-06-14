import { describe, expect, it } from 'vitest';
import { recommendAgents } from './recommend';

/**
 * The recommender previews the specialist team for a brief. These pin that it
 * surfaces on-topic agents, respects the cap, enforces division diversity, and
 * returns nothing for an empty/stopword-only brief (so vague input yields no
 * noisy suggestions).
 */

describe('recommendAgents', () => {
  it('returns nothing for an empty or stopword-only brief', () => {
    expect(recommendAgents('')).toEqual([]);
    expect(recommendAgents('the and for with')).toEqual([]);
  });

  it('respects the limit', () => {
    const recs = recommendAgents('security marketing finance design code data', { limit: 4 });
    expect(recs.length).toBeLessThanOrEqual(4);
  });

  it('surfaces a security specialist for a security brief', () => {
    const recs = recommendAgents('Audit the codebase for security vulnerabilities and threats', { limit: 6 });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.division === 'security' || /security|threat|secops|pentest/i.test(r.name))).toBe(true);
    // Every returned agent must have a positive score.
    expect(recs.every((r) => r.score > 0)).toBe(true);
  });

  it('caps how many come from one division', () => {
    const recs = recommendAgents(
      'marketing marketing marketing growth seo content campaign launch audience',
      { limit: 8, perDivision: 2 },
    );
    const counts = new Map<string, number>();
    for (const r of recs) counts.set(r.division, (counts.get(r.division) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });
});
