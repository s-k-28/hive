import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The final artifact viewer. Opens in-app and renders the deliverable as real
 * markdown, with copy and download controls. The artifact url may be a live
 * Storage URL (live mode) or a data: URL (offline simulation); both are fetched
 * the same way. Triggered from the artifact chip in ProgressArtifact.
 */

interface ArtifactViewerProps {
  url: string;
  name: string;
  onClose: () => void;
}

export function ArtifactViewer({ url, name, onClose }: ArtifactViewerProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset content when the url changes by comparing against tracked state
  // during render (React's sanctioned pattern), so a new url shows the loading
  // state immediately instead of stale content.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  if (loadedUrl !== url) {
    setLoadedUrl(url);
    setMarkdown(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load artifact (${r.status})`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setMarkdown(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load artifact');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Copy failed.');
    }
  };

  const download = () => {
    const blob = new Blob([markdown ?? ''], { type: 'text/markdown' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="av-backdrop interactive" onClick={onClose}>
      <div
        className="av glass"
        role="dialog"
        aria-label="Final artifact"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="av-head">
          <div className="av-titlebar">
            <ArtifactGlyph />
            <span className="av-name">{name}</span>
          </div>
          <div className="av-actions">
            <button type="button" className="av-btn" onClick={copy} disabled={!markdown}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="av-btn av-btn-primary" onClick={download} disabled={!markdown}>
              Download
            </button>
            <button type="button" className="av-close" onClick={onClose} aria-label="Close">
              <CloseGlyph />
            </button>
          </div>
        </div>
        <div className="av-scroll">
          {error ? (
            <p className="av-error">{error}</p>
          ) : markdown == null ? (
            <p className="av-loading">Loading deliverable...</p>
          ) : (
            <div className="av-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M7 3.5h6.5L18 8v12.5H7Z"
        fill="none"
        stroke="var(--green)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M13 3.5V8h4.5"
        fill="none"
        stroke="var(--green)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
