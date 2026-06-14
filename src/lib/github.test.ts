import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ghViewer,
  ghListRepos,
  ghListBranches,
  buildRepoContext,
  repoContextToPrompt,
  GithubError,
} from './github';

/**
 * The GitHub client is the read-only bridge between HIVE and a user's repos. It
 * is pure fetch, so these tests stub global fetch and pin the response mapping,
 * the auth-failure path, and the bounded repo-context bundler (which must cap
 * file count and bytes so a big repo never blows the model context).
 */

const TOKEN = 'ghp_test';

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string) => {
    const { status = 200, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    } as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ghViewer', () => {
  it('maps the authenticated user', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: { login: 'octocat', name: 'Octo', avatar_url: 'u' } })));
    const user = await ghViewer(TOKEN);
    expect(user).toEqual({ login: 'octocat', name: 'Octo', avatarUrl: 'u' });
  });

  it('throws GithubError(401) on a bad token', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ status: 401, body: {} })));
    await expect(ghViewer('bad')).rejects.toBeInstanceOf(GithubError);
    await expect(ghViewer('bad')).rejects.toMatchObject({ status: 401 });
  });
});

describe('ghListRepos / ghListBranches', () => {
  it('maps repo rows to camelCase', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({
        body: [
          {
            full_name: 'me/app',
            name: 'app',
            owner: { login: 'me' },
            private: true,
            description: 'd',
            default_branch: 'main',
            language: 'TypeScript',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      })),
    );
    const repos = await ghListRepos(TOKEN);
    expect(repos[0]).toMatchObject({ fullName: 'me/app', owner: 'me', defaultBranch: 'main', private: true });
  });

  it('returns branch names', async () => {
    vi.stubGlobal('fetch', mockFetch(() => ({ body: [{ name: 'main' }, { name: 'dev' }] })));
    expect(await ghListBranches(TOKEN, 'me/app')).toEqual(['main', 'dev']);
  });
});

describe('buildRepoContext', () => {
  it('lists the tree, pulls the README, and respects caps', async () => {
    const readme = '# My App\nDoes things.';
    vi.stubGlobal(
      'fetch',
      mockFetch((url) => {
        if (url.includes('/git/trees/')) {
          return {
            body: {
              truncated: false,
              tree: [
                { path: 'README.md', type: 'blob', size: readme.length },
                { path: 'src/index.ts', type: 'blob', size: 50 },
                { path: 'src', type: 'tree' },
                { path: 'logo.png', type: 'blob', size: 999 }, // non-source, excluded from tree summary
              ],
            },
          };
        }
        if (url.includes('/contents/README.md')) {
          return { body: { content: btoa(readme), encoding: 'base64', size: readme.length } };
        }
        return { body: { content: btoa('x'), encoding: 'base64', size: 1 } };
      }),
    );
    const ctx = await buildRepoContext(TOKEN, 'me/app', 'main', { maxFiles: 2 });
    expect(ctx.tree).toContain('README.md');
    expect(ctx.tree).toContain('src/index.ts');
    expect(ctx.tree).not.toContain('logo.png');
    expect(ctx.files.some((f) => f.path === 'README.md' && f.content.includes('My App'))).toBe(true);
    expect(ctx.files.length).toBeLessThanOrEqual(2);

    const prompt = repoContextToPrompt(ctx);
    expect(prompt).toContain('Repository: me/app @ main');
    expect(prompt).toContain('README.md');
  });
});
