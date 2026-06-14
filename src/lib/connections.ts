import { getClient } from './insforge';
import { ghViewer, type GithubUser } from './github';

/**
 * GitHub connection state for the browser.
 *
 * The token lives in localStorage so the web app, the picker, and repo previews
 * work immediately. In live mode, when the user is signed in, the token is also
 * upserted into the `connections` table (RLS: owner-only) so the orchestrator
 * edge function can read it server-side to pull repo context during a mission.
 * Read-only scope; nothing here can mutate a repo.
 *
 * NOTE: the token is stored at rest (localStorage + DB column). For this
 * read-only build that is an accepted tradeoff; a follow-up should encrypt the
 * column or move to a short-lived GitHub App installation token.
 */

const TOKEN_KEY = 'hive.github.token';
const LOGIN_KEY = 'hive.github.login';

export function getGithubToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getGithubLogin(): string | null {
  try {
    return localStorage.getItem(LOGIN_KEY);
  } catch {
    return null;
  }
}

export function isGithubConnected(): boolean {
  return Boolean(getGithubToken());
}

/**
 * Validate a token against GitHub, store it locally, and (live + signed in)
 * mirror it to the connections table. Returns the authenticated user. Throws if
 * the token is invalid so the connect UI can show the error.
 */
export async function connectGithub(token: string): Promise<GithubUser> {
  const user = await ghViewer(token); // throws GithubError on a bad token
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LOGIN_KEY, user.login);
  } catch {
    // localStorage unavailable (private mode); in-memory use still works.
  }
  await persistConnection(token, user.login);
  return user;
}

export function disconnectGithub(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOGIN_KEY);
  } catch {
    // ignore
  }
  void removeConnection();
}

/** Upsert the token into the connections table for the signed-in user. Best
 *  effort: a failure here only means live missions can't pull repo context. */
async function persistConnection(token: string, login: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const { data } = await client.auth.getCurrentUser();
    const userId = (data as { user?: { id?: string } } | null)?.user?.id ?? null;
    if (!userId) return; // anon: no server-side store; repo context needs sign-in
    await client.database
      .from('connections')
      .upsert(
        { user_id: userId, provider: 'github', access_token: token, login },
        { onConflict: 'user_id,provider' },
      );
  } catch (e) {
    console.error('[hive] persist github connection failed', e);
  }
}

async function removeConnection(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const { data } = await client.auth.getCurrentUser();
    const userId = (data as { user?: { id?: string } } | null)?.user?.id ?? null;
    if (!userId) return;
    await client.database
      .from('connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'github');
  } catch (e) {
    console.error('[hive] remove github connection failed', e);
  }
}
