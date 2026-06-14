import { useEffect, useState } from 'react';
import { GitBranch, Search, X, Check } from 'lucide-react';
import {
  connectGithub,
  disconnectGithub,
  getGithubLogin,
  getGithubToken,
} from '../lib/connections';
import { ghListRepos, ghListBranches, GithubError, type GithubRepo } from '../lib/github';
import type { RepoRef } from '../lib/types';

/**
 * Connect GitHub (read-only PAT) and pick a repo + branch for a mission. Two
 * states: not connected -> token form; connected -> searchable repo list with a
 * branch selector. Calls onSelect with the chosen RepoRef. Mounts only when
 * opened from the mission console.
 */

interface RepoPickerProps {
  onSelect: (repo: RepoRef) => void;
  onClose: () => void;
}

export function RepoPicker({ onSelect, onClose }: RepoPickerProps) {
  const [login, setLogin] = useState<string | null>(getGithubLogin());
  const connected = Boolean(getGithubToken()) && Boolean(login);

  return (
    <div className="mh-backdrop interactive" onClick={onClose}>
      <div className="mh rp glass" role="dialog" aria-label="Connect a repository" onClick={(e) => e.stopPropagation()}>
        <div className="mh-head">
          <span className="mh-eyebrow"><GitBranch size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />Repository</span>
          <button type="button" className="mh-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {connected ? (
          <RepoList login={login!} onSelect={onSelect} onDisconnect={() => { disconnectGithub(); setLogin(null); }} />
        ) : (
          <Connect onConnected={(u) => setLogin(u)} />
        )}
      </div>
    </div>
  );
}

function Connect({ onConnected }: { onConnected: (login: string) => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const user = await connectGithub(token.trim());
      onConnected(user.login);
    } catch (e) {
      setError(
        e instanceof GithubError && e.status === 401
          ? 'That token was rejected. Check it has read access to repository contents.'
          : 'Could not reach GitHub. Check the token and your connection.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rp-connect">
      <p className="rp-lead">Connect GitHub with a read-only access token. HIVE reads repo files for context and never writes.</p>
      <ol className="rp-steps">
        <li>
          Create a token at{' '}
          <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
            github.com/settings/tokens
          </a>{' '}
          (fine-grained), with <b>Contents: Read-only</b> on the repos you want.
        </li>
        <li>Paste it below. It is stored locally and, when signed in, in your account.</li>
      </ol>
      <input
        className="rp-input"
        type="password"
        placeholder="github_pat_… or ghp_…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        autoFocus
      />
      {error && <p className="rp-error">{error}</p>}
      <button type="button" className="mc-launch" disabled={busy || !token.trim()} onClick={() => void submit()}>
        {busy ? 'Connecting…' : 'Connect GitHub'}
      </button>
    </div>
  );
}

function RepoList({
  login,
  onSelect,
  onDisconnect,
}: {
  login: string;
  onSelect: (repo: RepoRef) => void;
  onDisconnect: () => void;
}) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GithubRepo | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [ref, setRef] = useState<string>('');

  useEffect(() => {
    const token = getGithubToken();
    if (!token) return;
    ghListRepos(token)
      .then(setRepos)
      .catch(() => setError('Could not load your repositories.'));
  }, []);

  const choose = async (repo: GithubRepo) => {
    setSelected(repo);
    setRef(repo.defaultBranch);
    setBranches(null);
    const token = getGithubToken();
    if (!token) return;
    try {
      setBranches(await ghListBranches(token, repo.fullName));
    } catch {
      setBranches([repo.defaultBranch]);
    }
  };

  const filtered = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <div className="rp-acct">
        <span><GitBranch size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{login}</span>
        <button type="button" className="rp-disconnect" onClick={onDisconnect}>Disconnect</button>
      </div>

      <div className="rp-searchbar">
        <Search size={14} aria-hidden="true" />
        <input
          className="rp-search"
          type="text"
          placeholder="Filter repositories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="mh-scroll rp-scroll">
        {error ? (
          <p className="mh-muted">{error}</p>
        ) : repos == null ? (
          <p className="mh-muted">Loading repositories…</p>
        ) : filtered.length === 0 ? (
          <p className="mh-muted">No repositories match.</p>
        ) : (
          <ul className="rp-list">
            {filtered.map((r) => (
              <li key={r.fullName}>
                <button
                  type="button"
                  className="rp-item"
                  data-selected={selected?.fullName === r.fullName || undefined}
                  onClick={() => void choose(r)}
                >
                  <span className="rp-item-name">
                    {r.fullName}
                    {r.private && <span className="rp-badge">private</span>}
                  </span>
                  {r.language && <span className="rp-lang">{r.language}</span>}
                  {selected?.fullName === r.fullName && <Check size={14} className="rp-check" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="rp-foot">
          <label className="rp-branch">
            <span>Branch</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)} disabled={branches == null}>
              {(branches ?? [selected.defaultBranch]).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mc-launch"
            onClick={() => onSelect({ provider: 'github', fullName: selected.fullName, ref: ref || selected.defaultBranch })}
          >
            Use {selected.name}
          </button>
        </div>
      )}
    </>
  );
}
