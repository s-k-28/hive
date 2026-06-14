import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X, Sparkles, Check } from 'lucide-react';
import {
  generateClarifyingQuestions,
  buildBrief,
  type ClarifyQuestion,
  type ClarifyAnswer,
} from '../lib/clarify';
import { recommendAgents, type AgentRecommendation } from '../lib/recommend';
import type { RepoRef } from '../lib/types';

/**
 * Pre-launch clarification chat. Before the swarm starts, HIVE asks a few
 * goal-aware questions (one at a time, chatbot style) and folds the answers into
 * a brief. onComplete(brief) hands that brief back to the launcher, which starts
 * the mission with it as guidance. The operator can skip any question, or skip
 * the whole thing and launch on the raw goal.
 */

interface ClarifyChatProps {
  goal: string;
  repo: RepoRef | null;
  onComplete: (brief: string) => void;
  onClose: () => void;
}

export function ClarifyChat({ goal, repo, onComplete, onClose }: ClarifyChatProps) {
  const [questions, setQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<ClarifyAnswer[]>([]);
  const [draft, setDraft] = useState('');
  // `dropped` holds slugs the operator removed from the suggested bench.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    generateClarifyingQuestions(goal, repo).then((qs) => {
      if (!cancelled) setQuestions(qs);
    });
    return () => { cancelled = true; };
  }, [goal, repo]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [index, questions, answers.length]);

  const current = questions?.[index] ?? null;
  const done = questions != null && index >= questions.length;

  // Recommend the specialist team once the questions are done, from the full
  // brief. Pure derivation, memoized so it recomputes only as answers land.
  const recs: AgentRecommendation[] = useMemo(
    () => (done ? recommendAgents(buildBrief(goal, answers), { limit: 6 }) : []),
    [done, goal, answers],
  );

  const record = (answer: string) => {
    if (!current) return;
    setAnswers((prev) => [...prev, { question: current.question, answer }]);
    setDraft('');
    setIndex((i) => i + 1);
  };

  const kept = recs.filter((r) => !dropped.has(r.slug));

  // Final brief = clarified goal + the specialist team the operator kept.
  const finalBrief = (): string => {
    const base = buildBrief(goal, answers);
    if (kept.length === 0) return base;
    return `${base}\n\nPreferred specialists for this work: ${kept.map((r) => r.name).join(', ')}.`;
  };

  const toggleAgent = (slug: string) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const launch = () => onComplete(finalBrief());

  return (
    <div className="mh-backdrop interactive" onClick={onClose}>
      <div className="mh cc glass" role="dialog" aria-label="Clarify the mission" onClick={(e) => e.stopPropagation()}>
        <div className="mh-head">
          <span className="mh-eyebrow"><Sparkles size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />Align the mission</span>
          <button type="button" className="mh-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="cc-thread" ref={threadRef}>
          <Bubble who="hive">
            Before I send the swarm in, a few quick questions so we build exactly what you want.
          </Bubble>
          <Bubble who="you" muted>{goal}</Bubble>
          {repo && <Bubble who="you" muted>repo: {repo.fullName} @ {repo.ref}</Bubble>}

          {/* Answered turns */}
          {answers.map((a, i) => (
            <div key={i}>
              <Bubble who="hive">{questions?.[i]?.question ?? a.question}</Bubble>
              <Bubble who="you">{a.answer || <em className="cc-skipped">skipped</em>}</Bubble>
            </div>
          ))}

          {/* Loading */}
          {questions == null && <Bubble who="hive"><span className="cc-typing"><i /><i /><i /></span></Bubble>}

          {/* Current question */}
          {current && <Bubble who="hive">{current.question}</Bubble>}

          {/* Done */}
          {done && (
            <>
              <Bubble who="hive">
                Got it. I'll brief the swarm with your answers so it builds exactly this. Ready when you are.
              </Bubble>
              {answers.some((a) => a.answer.trim()) && (
                <div className="cc-brief">
                  <div className="cc-brief-label">Mission brief</div>
                  <pre className="cc-brief-body">{buildBrief(goal, answers)}</pre>
                </div>
              )}
              {recs.length > 0 && (
                <>
                  <Bubble who="hive">
                    Based on this, here's the specialist team I'd bring in. Tap any to drop it.
                  </Bubble>
                  <div className="cc-team">
                    {recs.map((a) => {
                      const on = !dropped.has(a.slug);
                      return (
                        <button
                          key={a.slug}
                          type="button"
                          className="cc-agent"
                          data-on={on || undefined}
                          onClick={() => toggleAgent(a.slug)}
                          title={`${a.name} · ${a.division}${a.vibe ? ` — ${a.vibe}` : ''}`}
                        >
                          <span className="cc-agent-emoji" aria-hidden="true">{a.emoji || '🤖'}</span>
                          <span className="cc-agent-body">
                            <span className="cc-agent-name">{a.name}</span>
                            <span className="cc-agent-div">{a.division}</span>
                          </span>
                          {on && <Check size={13} className="cc-agent-check" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div className="cc-foot">
          {current ? (
            <>
              {current.kind === 'choice' && current.options && (
                <div className="cc-chips">
                  {current.options.map((opt) => (
                    <button key={opt} type="button" className="cc-chip" onClick={() => record(opt)}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div className="cc-compose">
                <input
                  className="cc-input"
                  type="text"
                  placeholder={current.placeholder || 'Type your answer…'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) record(draft.trim()); }}
                  autoFocus
                />
                <button type="button" className="cc-send" disabled={!draft.trim()} onClick={() => record(draft.trim())} aria-label="Send">
                  <Send size={15} />
                </button>
              </div>
              <div className="cc-meta">
                <span>Question {index + 1} of {questions?.length ?? 0}</span>
                <button type="button" className="cc-skip" onClick={() => record('')}>Skip</button>
              </div>
            </>
          ) : done ? (
            <button type="button" className="cc-launch" onClick={launch}>Launch swarm</button>
          ) : (
            <div className="cc-meta"><span>Reviewing your goal…</span></div>
          )}

          {!done && (
            <button type="button" className="cc-skipall" onClick={() => onComplete(buildBrief(goal, answers))}>
              Skip questions and launch now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({ who, muted, children }: { who: 'hive' | 'you'; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="cc-row" data-who={who}>
      <div className="cc-bubble" data-who={who} data-muted={muted || undefined}>{children}</div>
    </div>
  );
}
