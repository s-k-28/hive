import { useState } from 'react';
import { signIn, signUp, signOut, type AuthUser } from '../lib/mission';
import { isLiveBackend } from '../lib/insforge';

/**
 * Auth panel: sign in / sign up / sign out, wired through the mission lib auth
 * helpers. Surfaced from the header. In offline mode (no InsForge project) the
 * panel explains that missions run anonymously, since there is no backend to
 * authenticate against.
 */

interface AuthProps {
  user: AuthUser | null;
  onChange: (user: AuthUser | null) => void;
  onClose: () => void;
}

type Mode = 'in' | 'up';

export function Auth({ user, onChange, onClose }: AuthProps) {
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === 'in'
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password, name.trim() || undefined);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.user) {
        onChange(result.user);
        onClose();
      } else {
        // Sign up may require email verification before a session exists.
        setError('Check your email to verify your account, then sign in.');
        setMode('in');
      }
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    onChange(null);
    setBusy(false);
    onClose();
  };

  return (
    <div className="au-backdrop interactive" onClick={onClose}>
      <div className="au glass" role="dialog" aria-label="Account" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="au-close" onClick={onClose} aria-label="Close">
          <CloseGlyph />
        </button>

        {!isLiveBackend ? (
          <div className="au-body">
            <h3 className="au-title">Offline mode</h3>
            <p className="au-sub">
              No InsForge project is wired, so missions run locally and
              anonymously. Sign in becomes available once the backend is
              connected.
            </p>
          </div>
        ) : user ? (
          <div className="au-body">
            <h3 className="au-title">Signed in</h3>
            <p className="au-sub">{user.email ?? user.name ?? 'Your account'}</p>
            <button type="button" className="au-submit" onClick={doSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="au-body">
            <h3 className="au-title">{mode === 'in' ? 'Sign in' : 'Create account'}</h3>
            <p className="au-sub">Your missions are saved to your account.</p>

            {mode === 'up' ? (
              <input
                className="au-input"
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            ) : null}
            <input
              className="au-input"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="au-input"
              type="password"
              placeholder="Password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />

            {error ? <p className="au-error">{error}</p> : null}

            <button
              type="button"
              className="au-submit"
              onClick={submit}
              disabled={busy || !email.trim() || !password}
            >
              {busy ? 'Working...' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>

            <button
              type="button"
              className="au-switch"
              onClick={() => {
                setMode(mode === 'in' ? 'up' : 'in');
                setError(null);
              }}
            >
              {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
