import { AGENT_CATALOG, type AgentMeta } from './agentCatalog';

/**
 * Recommend specialists from the catalog for a mission brief, client-side.
 *
 * A keyword-overlap score over each agent's name/division/tags/description/vibe,
 * with division diversity so the suggested bench isn't five of the same kind.
 * Runs fully offline against the bundled catalog, so the clarify chat can show
 * the team before launch. (The live orchestrator still does its own pgvector
 * match per task; this is the human-facing preview that builds confidence.)
 */

export interface AgentRecommendation extends AgentMeta {
  score: number;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'into', 'from', 'your', 'you', 'are',
  'our', 'out', 'all', 'can', 'will', 'should', 'make', 'want', 'need', 'have', 'has',
  'how', 'what', 'who', 'why', 'when', 'which', 'a', 'an', 'to', 'of', 'in', 'on', 'is',
  'it', 'be', 'do', 'or', 'as', 'at', 'by', 'we', 'i', 'me', 'my', 'so', 'up', 'plan',
  'build', 'create', 'help', 'work', 'thing', 'things', 'using', 'use',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Top specialists for a brief. Caps per division (default 2) so the team is
 * varied, and returns at most `limit`. Only agents with a positive score are
 * returned, so a vague brief yields fewer (or no) suggestions rather than noise.
 */
export function recommendAgents(
  brief: string,
  opts: { limit?: number; perDivision?: number } = {},
): AgentRecommendation[] {
  const limit = opts.limit ?? 6;
  const perDivision = opts.perDivision ?? 2;
  const tokens = tokenize(brief);
  if (tokens.length === 0) return [];

  // Distinct query tokens; repeated words in the brief shouldn't inflate score.
  const queryTerms = new Set(tokens);

  const scored: AgentRecommendation[] = [];
  for (const agent of AGENT_CATALOG) {
    const name = agent.name.toLowerCase();
    const division = agent.division.toLowerCase();
    const tagText = agent.tags.join(' ').toLowerCase();
    const desc = agent.description.toLowerCase();
    const vibe = agent.vibe.toLowerCase();

    let score = 0;
    for (const term of queryTerms) {
      if (name.includes(term)) score += 4;
      if (division.includes(term) || tagText.includes(term)) score += 2;
      if (desc.includes(term)) score += 1;
      if (vibe.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ ...agent, score });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // Diversity pass: cap each division, fill to limit.
  const perDivCount = new Map<string, number>();
  const picked: AgentRecommendation[] = [];
  for (const a of scored) {
    if (picked.length >= limit) break;
    const n = perDivCount.get(a.division) ?? 0;
    if (n >= perDivision) continue;
    perDivCount.set(a.division, n + 1);
    picked.push(a);
  }
  return picked;
}
