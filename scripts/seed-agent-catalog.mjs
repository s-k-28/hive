#!/usr/bin/env node
/**
 * Seed the agents_catalog table from scripts/agentCatalog.full.json: compute an
 * embedding for each specialist (so the orchestrator can match tasks to experts
 * via match_agents) and upsert the full rows incl. persona.
 *
 * Run once after applying migrations, and again whenever the catalog changes.
 * Requires (env, set before running — never commit these):
 *   INSFORGE_URL        your project's API base, e.g. https://xxxx.us-east.insforge.app
 *   INSFORGE_API_KEY    the project admin (service-role) key — bypasses RLS to write
 *   OPENROUTER_API_KEY  the AI gateway key (the same secret the orchestrator uses)
 * Optional:
 *   AI_BASE_URL         AI gateway base URL (default https://openrouter.ai/api/v1)
 *   AI_EMBED_MODEL      embedding model (default openai/text-embedding-3-small, 1536 dims)
 *
 * Usage: INSFORGE_URL=… INSFORGE_API_KEY=… OPENROUTER_API_KEY=… \
 *          node scripts/seed-agent-catalog.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminClient } from '@insforge/sdk';
import OpenAI from 'openai';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const INSFORGE_URL = process.env.INSFORGE_URL;
const INSFORGE_API_KEY = process.env.INSFORGE_API_KEY;
const AI_KEY = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1';
const EMBED_MODEL = process.env.AI_EMBED_MODEL || 'openai/text-embedding-3-small';

const missing = [];
if (!INSFORGE_URL) missing.push('INSFORGE_URL');
if (!INSFORGE_API_KEY) missing.push('INSFORGE_API_KEY');
if (!AI_KEY) missing.push('OPENROUTER_API_KEY');
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}\nSee the header of this file for what each is.`);
  process.exit(1);
}

const agents = JSON.parse(readFileSync(join(ROOT, 'scripts/agentCatalog.full.json'), 'utf8'));
console.log(`Loaded ${agents.length} agents from scripts/agentCatalog.full.json`);

const db = createAdminClient({ baseUrl: INSFORGE_URL, apiKey: INSFORGE_API_KEY });
const ai = new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_KEY });

/** The text we embed for matching: identity + what the agent is for. Persona
 *  body is excluded so similarity keys on role/skill, not prose length. */
const embedText = (a) =>
  `${a.name} (${a.division}). ${a.description} ${a.vibe}`.replace(/\s+/g, ' ').trim().slice(0, 2000);

async function embedBatch(texts) {
  const res = await ai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

// Compute embeddings in batches (embeddings API takes an array input).
const EMBED_BATCH = 64;
const embeddings = new Array(agents.length);
for (let i = 0; i < agents.length; i += EMBED_BATCH) {
  const slice = agents.slice(i, i + EMBED_BATCH);
  const vecs = await embedBatch(slice.map(embedText));
  for (let j = 0; j < slice.length; j++) embeddings[i + j] = vecs[j];
  console.log(`  embedded ${Math.min(i + EMBED_BATCH, agents.length)}/${agents.length}`);
}

const rows = agents.map((a, i) => ({
  slug: a.slug,
  name: a.name,
  division: a.division,
  subdivision: a.subdivision ?? null,
  emoji: a.emoji ?? '',
  vibe: a.vibe ?? '',
  description: a.description ?? '',
  persona: a.persona ?? '',
  tags: a.tags ?? [],
  embedding: embeddings[i],
}));

// Upsert in chunks (one big request risks a payload limit; personas are large).
const WRITE_CHUNK = 25;
let written = 0;
for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
  const chunk = rows.slice(i, i + WRITE_CHUNK);
  const { error } = await db.database
    .from('agents_catalog')
    .upsert(chunk, { onConflict: 'slug' });
  if (error) {
    console.error('upsert failed at chunk', i, error);
    process.exit(1);
  }
  written += chunk.length;
  console.log(`  upserted ${written}/${rows.length}`);
}

console.log(`\nSeeded ${written} specialists into agents_catalog.`);
