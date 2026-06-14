#!/usr/bin/env node
/**
 * Build the HIVE specialist-agent catalog by merging several agent collections
 * (all MIT-licensed) into one set. Walks each source with its own layout +
 * division rule, parses `--- ... ---` frontmatter (name, description, and where
 * present color/emoji/vibe) plus the markdown body (the persona), dedupes by
 * slug across sources, and emits:
 *
 *   src/data/agentCatalog.json     lightweight metadata for the browser bundle
 *   scripts/agentCatalog.full.json full records incl. persona — the DB seed source
 *
 * Sources (clone shallowly to /tmp, then run this):
 *   agency     msitarzewski/agency-agents               division = top folder
 *   voltagent  VoltAgent/awesome-claude-code-subagents  division = categories/NN-<div>
 *   wshobson   wshobson/agents                          division = keyword bucket of plugin
 *   0xfurai    0xfurai/claude-code-subagents            division = engineering (tech experts)
 *
 * A missing source path is skipped, so this still runs with only agency present.
 * Usage: node scripts/build-agent-catalog.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  { id: 'agency', kind: 'agency', path: '/tmp/agency-agents' },
  { id: 'voltagent', kind: 'voltagent', path: '/tmp/VoltAgent_awesome-claude-code-subagents' },
  { id: 'wshobson', kind: 'wshobson', path: '/tmp/wshobson_agents' },
  { id: '0xfurai', kind: '0xfurai', path: '/tmp/0xfurai_claude-code-subagents' },
];

const AGENCY_DIVISIONS = [
  'academic', 'design', 'engineering', 'finance', 'game-development', 'gis',
  'marketing', 'paid-media', 'product', 'project-management', 'sales',
  'security', 'spatial-computing', 'specialized', 'strategy', 'support', 'testing',
];

// Exact doc filenames to skip (not prefixes — agency has real agents like
// security-compliance-auditor.md that must NOT be dropped).
const SKIP_NAMES = new Set([
  'readme.md', 'contributing.md', 'security.md', 'license.md', 'code_of_conduct.md',
  'claude.md', 'gemini.md', 'agents.md', 'architecture.md',
]);

/** Coarse division bucket for a wshobson plugin name (≈100 plugins → ~12 divisions). */
function wshobsonDivision(plugin) {
  const p = plugin.toLowerCase();
  const has = (...k) => k.some((s) => p.includes(s));
  if (has('security', 'secure', 'auth', 'crypto', 'compliance')) return 'security';
  if (has('data', 'sql', 'database', 'analytics', 'etl')) return 'data';
  if (has('ml', 'ai', 'llm', 'model', 'prompt')) return 'data-ai';
  if (has('frontend', 'react', 'ui', 'ux', 'css', 'accessibility', 'mobile', 'ios', 'android')) return 'frontend';
  if (has('deploy', 'infra', 'devops', 'kubernetes', 'docker', 'terraform', 'cloud', 'sre', 'observability')) return 'infrastructure';
  if (has('test', 'tdd', 'qa')) return 'testing';
  if (has('payment', 'business', 'product', 'marketing', 'seo', 'sales')) return 'business-product';
  if (has('doc', 'content', 'writing')) return 'documentation';
  if (has('orchestr', 'agent', 'workflow', 'conductor')) return 'meta-orchestration';
  if (has('api', 'backend', 'server')) return 'backend';
  return 'engineering';
}

/** Parse leading `---`-delimited frontmatter into a flat map + the markdown body. */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: {}, body: text.trim() };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: text.trim() };
  const head = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\s*\n/, '').trim();
  const fm = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  return { fm, body };
}

function findMd(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findMd(full, acc);
    else if (entry.endsWith('.md') && !SKIP_NAMES.has(entry.toLowerCase())) acc.push(full);
  }
}

/** Collect {file, division, subdivision} records for one source. */
function collect(source) {
  if (!existsSync(source.path)) {
    console.warn(`! source missing, skipping: ${source.id} (${source.path})`);
    return [];
  }
  const out = [];
  if (source.kind === 'agency') {
    for (const division of AGENCY_DIVISIONS) {
      const dir = join(source.path, division);
      if (!existsSync(dir)) continue;
      const files = [];
      findMd(dir, files);
      for (const f of files) {
        const sub = dirname(f) === dir ? null : basename(dirname(f));
        out.push({ file: f, division, subdivision: sub });
      }
    }
  } else if (source.kind === 'voltagent') {
    const cats = join(source.path, 'categories');
    if (existsSync(cats)) {
      for (const cat of readdirSync(cats)) {
        const dir = join(cats, cat);
        if (!statSync(dir).isDirectory()) continue;
        const division = cat.replace(/^\d+-/, '');
        const files = [];
        findMd(dir, files);
        for (const f of files) out.push({ file: f, division, subdivision: null });
      }
    }
  } else if (source.kind === 'wshobson') {
    const files = [];
    const pluginsDir = join(source.path, 'plugins');
    if (existsSync(pluginsDir)) findMd(pluginsDir, files);
    for (const f of files) {
      if (!f.includes('/agents/')) continue; // only agent files, not skills/commands
      const plugin = f.split('/plugins/')[1]?.split('/')[0] ?? 'engineering';
      out.push({ file: f, division: wshobsonDivision(plugin), subdivision: plugin });
    }
  } else if (source.kind === '0xfurai') {
    const dir = join(source.path, 'agents');
    if (existsSync(dir)) {
      const files = [];
      findMd(dir, files);
      for (const f of files) out.push({ file: f, division: 'engineering', subdivision: null });
    }
  }
  return out;
}

const lite = [];
const full = [];
const seen = new Map(); // slug -> source id
const perSource = {};

for (const source of SOURCES) {
  const records = collect(source);
  let kept = 0;
  for (const { file, division, subdivision } of records) {
    const raw = readFileSync(file, 'utf8');
    const { fm, body } = parseFrontmatter(raw);
    if (!body) continue;
    let slug = (fm.name && /^[a-z0-9-]+$/.test(fm.name) ? fm.name : basename(file, '.md')).toLowerCase();
    if (seen.has(slug)) slug = `${slug}-${source.id}`;
    if (seen.has(slug)) continue; // still colliding, drop
    seen.set(slug, source.id);

    const name = fm.name && !/^[a-z0-9-]+$/.test(fm.name)
      ? fm.name
      : (fm.name || basename(file, '.md')).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const description = (fm.description || '').replace(/\s+/g, ' ').trim();
    const emoji = fm.emoji || '';
    const vibe = (fm.vibe || '').replace(/\s+/g, ' ').trim();
    const tags = [division, subdivision, source.id].filter(Boolean);

    lite.push({ slug, name, division, subdivision: subdivision || null, emoji, vibe, description: description.slice(0, 280), source: source.id, tags });
    full.push({ slug, name, division, subdivision: subdivision || null, emoji, vibe, description, source: source.id, tags, persona: body.slice(0, 20000) });
    kept++;
  }
  perSource[source.id] = kept;
}

lite.sort((a, b) => (a.division + a.slug).localeCompare(b.division + b.slug));
full.sort((a, b) => (a.division + a.slug).localeCompare(b.division + b.slug));

writeFileSync(join(ROOT, 'src/data/agentCatalog.json'), JSON.stringify(lite, null, 0) + '\n');
writeFileSync(join(ROOT, 'scripts/agentCatalog.full.json'), JSON.stringify(full, null, 0) + '\n');

const byDiv = {};
for (const a of lite) byDiv[a.division] = (byDiv[a.division] || 0) + 1;
console.log(`Built catalog: ${lite.length} agents across ${Object.keys(byDiv).length} divisions`);
console.log('By source: ' + Object.entries(perSource).map(([s, n]) => `${s}=${n}`).join(', '));
console.log('By division:');
console.log(Object.entries(byDiv).sort().map(([d, n]) => `  ${d}: ${n}`).join('\n'));
