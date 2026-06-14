/**
 * Read-only GitHub REST client for HIVE.
 *
 * Token-based (a fine-grained or classic PAT with read access to repo contents).
 * A token is the one credential that works identically across the web app, the
 * `hive` CLI, and the VS Code extension without hosting an OAuth callback, and
 * the CLI can lift it straight from `gh auth token`. Pure fetch, no SDK, so the
 * same module runs in the browser, in Node (CLI), and — mirrored — in the Deno
 * orchestrator. Every call is read-only; nothing here can mutate a repo.
 */

const GH_API = 'https://api.github.com';

export interface GithubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface GithubRepo {
  fullName: string; // owner/name
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
}

export interface RepoTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

/** A bounded bundle of repo content, sized for an LLM prompt. */
export interface RepoContext {
  fullName: string;
  ref: string;
  /** A compact file-tree listing (one path per line, capped). */
  tree: string;
  /** A few whole files most useful for orientation (README + entry points). */
  files: { path: string; content: string }[];
  truncated: boolean;
}

export class GithubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const detail = res.status === 401 ? 'invalid or expired token' : res.statusText;
    throw new GithubError(`GitHub ${res.status}: ${detail}`, res.status);
  }
  return (await res.json()) as T;
}

/** Validate a token and return the authenticated user. Throws GithubError(401)
 *  when the token is bad — callers use this as the "connect" check. */
export async function ghViewer(token: string): Promise<GithubUser> {
  const u = await gh<{ login: string; name: string | null; avatar_url: string }>(token, '/user');
  return { login: u.login, name: u.name, avatarUrl: u.avatar_url };
}

/** The viewer's repos, most-recently-updated first (capped to 100). */
export async function ghListRepos(token: string): Promise<GithubRepo[]> {
  const rows = await gh<
    {
      full_name: string;
      name: string;
      owner: { login: string };
      private: boolean;
      description: string | null;
      default_branch: string;
      language: string | null;
      updated_at: string;
    }[]
  >(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return rows.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
    language: r.language,
    updatedAt: r.updated_at,
  }));
}

/** Branch names for a repo (capped to 100). */
export async function ghListBranches(token: string, fullName: string): Promise<string[]> {
  const rows = await gh<{ name: string }[]>(token, `/repos/${fullName}/branches?per_page=100`);
  return rows.map((b) => b.name);
}

/** The full recursive file tree at a ref. GitHub caps and may flag truncated. */
export async function ghRepoTree(
  token: string,
  fullName: string,
  ref: string,
): Promise<{ entries: RepoTreeEntry[]; truncated: boolean }> {
  const data = await gh<{
    tree: { path: string; type: string; size?: number }[];
    truncated: boolean;
  }>(token, `/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  const entries = (data.tree ?? [])
    .filter((e) => e.type === 'blob' || e.type === 'tree')
    .map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.size ?? 0 }));
  return { entries, truncated: Boolean(data.truncated) };
}

/** Decode GitHub's base64 (with embedded newlines) to UTF-8 text. */
function decodeBase64(b64: string): string {
  const clean = b64.replace(/\n/g, '');
  // atob exists in browsers, Node 16+, and Deno. Decode to UTF-8 safely.
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Raw text of one file at a ref, or null if it is missing/too large/binary. */
export async function ghFileContent(
  token: string,
  fullName: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const data = await gh<{ content?: string; encoding?: string; size?: number }>(
      token,
      `/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (!data.content || data.encoding !== 'base64') return null;
    return decodeBase64(data.content);
  } catch (e) {
    if (e instanceof GithubError && e.status === 404) return null;
    throw e;
  }
}

// Files worth pulling whole for orientation: docs and likely entry points.
const ORIENT_PATTERNS = [
  /^readme(\.md|\.txt)?$/i,
  /^package\.json$/i,
  /^(pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml|gemfile)$/i,
  /^(src\/)?(main|index|app|cli)\.(ts|tsx|js|jsx|py|go|rs|rb)$/i,
];

// Source-ish files we are willing to list/sample in the tree summary.
const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|sql|sh|md|json|ya?ml|toml)$/i;

/**
 * Build a bounded, prompt-sized snapshot of a repo: a compact file-tree listing
 * plus a few whole orientation files (README, manifest, entry points). Caps both
 * the tree and total file bytes so it never blows the model context. Best effort.
 */
export async function buildRepoContext(
  token: string,
  fullName: string,
  ref: string,
  opts: { maxFiles?: number; maxBytes?: number; maxTreeEntries?: number } = {},
): Promise<RepoContext> {
  const maxFiles = opts.maxFiles ?? 5;
  const maxBytes = opts.maxBytes ?? 12_000;
  const maxTreeEntries = opts.maxTreeEntries ?? 400;

  const { entries, truncated } = await ghRepoTree(token, fullName, ref);
  const blobs = entries.filter((e) => e.type === 'blob');

  // Tree summary: source-ish paths, shortest first, capped.
  const treePaths = blobs
    .filter((e) => SOURCE_EXT.test(e.path))
    .map((e) => e.path)
    .sort((a, b) => a.length - b.length)
    .slice(0, maxTreeEntries);
  const tree = treePaths.join('\n');

  // Pick orientation files by pattern, in pattern priority order.
  const picked: string[] = [];
  for (const pat of ORIENT_PATTERNS) {
    for (const e of blobs) {
      if (picked.length >= maxFiles) break;
      if (pat.test(e.path) && !picked.includes(e.path)) picked.push(e.path);
    }
  }

  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  for (const path of picked) {
    if (files.length >= maxFiles || bytes >= maxBytes) break;
    const content = await ghFileContent(token, fullName, path, ref).catch(() => null);
    if (!content) continue;
    const slice = content.slice(0, Math.max(0, maxBytes - bytes));
    bytes += slice.length;
    files.push({ path, content: slice });
  }

  return { fullName, ref, tree, files, truncated: truncated || treePaths.length < blobs.length };
}

/** Render a RepoContext as a single prompt block for an agent. */
export function repoContextToPrompt(ctx: RepoContext): string {
  const fileBlocks = ctx.files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join('\n\n');
  return (
    `Repository: ${ctx.fullName} @ ${ctx.ref}\n\n` +
    `File tree (partial${ctx.truncated ? ', truncated' : ''}):\n${ctx.tree}\n\n` +
    (fileBlocks ? `Key files:\n${fileBlocks}` : '')
  );
}
