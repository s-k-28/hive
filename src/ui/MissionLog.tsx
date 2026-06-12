import { useEffect, useRef } from 'react';
import { useSwarm } from '../state/swarm';
import { colorOf, labelOf } from './agentMeta';

/**
 * Live mission log. Streams swarm reasoning, newest at the bottom, auto
 * scrolled. The signature "watch the swarm think" surface.
 */
export function MissionLog() {
  const log = useSwarm((s) => s.log);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Keep pinned to the bottom unless the viewer has scrolled up to read.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance < 48;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  if (log.length === 0) return null;

  return (
    <section className="lg glass interactive" aria-label="Live mission log">
      <div className="lg-head">
        <span className="lg-title">Live mission log</span>
        <span className="lg-count">{log.length}</span>
      </div>
      <div className="lg-scroll" ref={scrollRef} onScroll={onScroll}>
        {log.map((line) => (
          <div className="lg-line" data-kind={line.kind} key={line.seq}>
            <span className="lg-agent" style={{ color: colorOf(line.agent) }}>
              {labelOf(line.agent)}
            </span>
            <span className="lg-text">{line.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
