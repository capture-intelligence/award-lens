import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown, Flag, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAiAward, useSetSelectedAward } from '@/lib/ai-award-context';
import type { AiAward } from '@/lib/ai-award-context';
import { useAgencyQuery } from '@/lib/agency-context';

type AgencyScope = ReturnType<typeof useAgencyQuery>;

type AskResponse = {
  intent: 'sql_query' | 'similar_awards' | 'general';
  summary?: string;
  answer?: string;
  sql?: string;
  cols?: string[];
  rows?: unknown[][];
  /** Total matching rows (sql_query intent). The `rows` field is
   *  capped at 50; `count` is the unbounded total off the same WHERE. */
  count?: number;
  audit_ids: number[];
  error?: string;
};

// Every assistant message carries the snapshot of context active at send-
// time (question, award context, agency scope). The "Report inaccuracy"
// form reads from this snapshot so the report is self-contained even after
// the user changes filters or selects a different award.
interface AssistantBase {
  id:           string;
  role:         'assistant';
  question:     string;
  awardContext: AiAward;
  agencyScope:  AgencyScope;
}

type Message =
  | { id: string; role: 'user'; text: string }
  | (AssistantBase & { status: 'loading' })
  | (AssistantBase & { status: 'error'; error: string })
  | (AssistantBase & { status: 'ok'; response: AskResponse });

const newId = () => Math.random().toString(36).slice(2, 10);

export function ConversationalIntelligenceWidget() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const awardCtx    = useAiAward();
  const agencyScope = useAgencyQuery();

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages / open.
  React.useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Focus input when opening.
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const query = draft.trim();
    if (!query || busy) return;

    // Snapshot context at send-time so a later filter change doesn't
    // mislabel reports filed against this answer.
    const ctxSnapshot   = awardCtx;
    const scopeSnapshot = agencyScope;
    const base: AssistantBase = {
      id: newId(),
      role: 'assistant',
      question: query,
      awardContext: ctxSnapshot,
      agencyScope:  scopeSnapshot,
    };
    const pendingId = base.id;
    const userMsg: Message = { id: newId(), role: 'user', text: query };
    const pending: Message = { ...base, status: 'loading' };
    setMessages((m) => [...m, userMsg, pending]);
    setDraft('');
    setBusy(true);

    // Build a lightweight conversation history — last 3 user/assistant
    // pairs, summary text only (never raw row data). Lets the worker
    // resolve "show me the details" / "what about Lantana?" follow-ups
    // by pulling entities out of the window of recent questions and
    // gives M1/M3 the conversational context for their generation.
    const HISTORY_TURNS = 3;
    const historyTurns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (let i = messages.length - 1; i >= 0 && historyTurns.length < HISTORY_TURNS * 2; i--) {
      const m = messages[i];
      if (m.role === 'user') {
        historyTurns.unshift({ role: 'user', text: m.text });
      } else if (m.role === 'assistant' && m.status === 'ok') {
        const r = m.response;
        const text = r.intent === 'general'
          ? (r.answer ?? '').slice(0, 280)
          : (r.summary ?? `[${r.intent}: ${r.count ?? r.rows?.length ?? 0} result(s)]`).slice(0, 280);
        historyTurns.unshift({ role: 'assistant', text });
      }
    }

    try {
      const res = await api.post<AskResponse>('/ai/v2/ask', {
        query,
        ...(ctxSnapshot   ? { context: ctxSnapshot   } : {}),
        // Send the active agency scope so similar_awards search stays
        // within the same agency the user is browsing.
        ...(scopeSnapshot ? { scope:   scopeSnapshot } : {}),
        ...(historyTurns.length > 0 ? { history: historyTurns } : {}),
      });
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId && msg.role === 'assistant'
            ? res.error
              ? { ...msg, status: 'error', error: res.error }
              : { ...msg, status: 'ok',    response: res }
            : msg,
        ),
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof (err.body as { error?: string } | null)?.error === 'string'
            ? (err.body as { error: string }).error
            : `Request failed (${err.status})`
          : err instanceof Error
            ? err.message
            : 'Request failed';
      setMessages((m) =>
        m.map((x) =>
          x.id === pendingId && x.role === 'assistant'
            ? { ...x, status: 'error', error: msg }
            : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      {/* Panel — right-edge, full-height, 25vw side rail */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="fixed right-0 top-0 z-40 flex h-full w-1/4 min-w-[340px] flex-col overflow-hidden border-l border-border bg-brand-teal-deep/95 backdrop-blur-xl shadow-glass-lg"
            role="dialog"
            aria-label="AI assistant"
          >
            <Header onClose={() => setOpen(false)} hasContext={!!awardCtx} />

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((m) => (
                    <MessageBubble key={m.id} message={m} />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border bg-brand-teal-deep/40 px-3 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask about awards, agencies, totals…"
                  className={cn(
                    'min-h-[40px] max-h-32 flex-1 resize-none rounded-lg border border-border bg-brand-teal-deep/60 px-3 py-2 text-sm text-foreground transition-colors',
                    'placeholder:text-muted-soft',
                    'focus-visible:outline-none focus-visible:border-brand-sage focus-visible:bg-brand-teal-deep/80',
                  )}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || draft.trim().length === 0}
                  aria-label="Send"
                  className={cn(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-all',
                    'bg-brand-vermilion text-brand-cream shadow-glow-vermilion hover:bg-brand-vermilion-deep active:scale-[0.96]',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
                  )}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-soft">
                Enter to send · Shift+Enter for newline
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating launcher — only shown when the side panel is closed.
          When open, the panel header carries its own close X, so the
          launcher would otherwise overlap the input area's Send button. */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="launcher"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open AI assistant"
            aria-expanded={false}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full transition-colors',
              'bg-brand-vermilion text-brand-cream shadow-glow-vermilion hover:bg-brand-vermilion-deep',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-vermilion/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'active:scale-[0.96]',
            )}
          >
            <MessageCircle className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

function Header({ onClose, hasContext }: { onClose: () => void; hasContext: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-b from-brand-teal-soft/40 to-brand-teal-deep/30 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-vermilion/15 text-brand-vermilion-soft ring-1 ring-brand-vermilion/40">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-semibold leading-tight text-foreground">Ask CaptureRadar</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-soft">
            {hasContext ? (
              <span className="text-brand-sage">Award context active</span>
            ) : (
              'Beta · session-scoped'
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-brand-teal-soft/30 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function EmptyState() {
  const awardCtx = useAiAward();
  const examples = awardCtx
    ? [
        'Find me similar awards expiring in the next 6 months',
        'Show other awards with this NAICS code',
        'Who else does this type of work?',
      ]
    : [
        'Top 10 contractors by total awards in FY2024',
        'How many active awards does NASA have?',
        'What does NAICS code 541512 mean?',
      ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-vermilion/10 text-brand-vermilion-soft ring-1 ring-brand-vermilion/30">
        <Sparkles className="h-5 w-5" />
      </span>
      <div>
        <div className="text-sm font-semibold text-foreground">Ask anything about the data</div>
        <div className="mt-1 text-xs text-muted">
          Natural-language questions get translated into SQL and answered.
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-left">
        {examples.map((ex) => (
          <li
            key={ex}
            className="rounded-lg border border-border bg-brand-teal-deep/30 px-3 py-2 text-xs text-muted"
          >
            {ex}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-vermilion/90 px-3.5 py-2 text-sm text-brand-cream shadow-glass">
          {message.text}
        </div>
      </div>
    );
  }

  // Reportable when the assistant has actually produced an answer (ok or
  // error). Loading bubbles aren't reportable yet — there's nothing to
  // critique.
  const reportable = message.status === 'ok' || message.status === 'error';

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-brand-teal-deep/55 px-3.5 py-2.5 text-sm text-foreground shadow-glass">
        {message.status === 'loading' && <LoadingDots />}
        {message.status === 'error' && (
          <div className="text-sm text-brand-vermilion-soft">
            <div className="font-semibold">Error</div>
            <div className="text-xs text-muted">{message.error}</div>
          </div>
        )}
        {message.status === 'ok' && <AssistantBody response={message.response} />}
      </div>
      {reportable && <ReportInaccuracy message={message} />}
    </div>
  );
}

function ReportInaccuracy({
  message,
}: {
  message: AssistantBase & ({ status: 'ok'; response: AskResponse } | { status: 'error'; error: string });
}) {
  const [open, setOpen]                               = React.useState(false);
  const [submitted, setSubmitted]                     = React.useState(false);
  const [inaccuracyDescription, setInaccuracyDescription] = React.useState('');
  const [expectedOutcome, setExpectedOutcome]         = React.useState('');
  const [examples, setExamples]                       = React.useState('');
  const [busy, setBusy]                               = React.useState(false);

  if (submitted) {
    return (
      <div className="ml-2 text-[10px] text-brand-sage">
        Thanks — report submitted.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center gap-1 text-[10px] text-muted-soft transition-colors hover:text-brand-vermilion-soft"
      >
        <Flag className="h-3 w-3" />
        Report inaccuracy
      </button>
    );
  }

  async function submit() {
    if (busy) return;
    if (!inaccuracyDescription.trim() || !expectedOutcome.trim()) return;
    setBusy(true);
    const auditId = message.status === 'ok'
      ? message.response.audit_ids?.[message.response.audit_ids.length - 1] ?? null
      : null;
    const intent = message.status === 'ok' ? message.response.intent : null;
    const actualResponse = message.status === 'ok'
      ? message.response
      : { error: message.error };
    try {
      await api.post('/ai/report-inaccuracy', {
        audit_id:               auditId,
        intent,
        question:               message.question,
        actual_response:        actualResponse,
        award_context:          message.awardContext,
        agency_scope:           message.agencyScope ?? null,
        inaccuracy_description: inaccuracyDescription.trim(),
        expected_outcome:       expectedOutcome.trim(),
        examples:               examples.trim() || undefined,
      });
      setSubmitted(true);
      toast.success('Report submitted — thanks for helping improve CaptureRadar.');
    } catch (err) {
      const msg = err instanceof ApiError
        ? `Failed (${err.status})`
        : err instanceof Error ? err.message : 'Failed to submit';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-2 w-full max-w-[92%] rounded-xl border border-border bg-brand-teal-deep/40 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-vermilion-soft">
          Report inaccuracy
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="grid h-5 w-5 place-items-center rounded text-muted-soft hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <ReportField
        label="What's wrong with this answer?"
        value={inaccuracyDescription}
        onChange={setInaccuracyDescription}
        placeholder="Describe the inaccuracy — wrong facts, missed rows, irrelevant results, etc."
        rows={3}
        required
      />
      <ReportField
        label="What did you expect instead?"
        value={expectedOutcome}
        onChange={setExpectedOutcome}
        placeholder="A correct or improved answer would have…"
        rows={3}
        required
      />
      <ReportField
        label="Example(s) — optional"
        value={examples}
        onChange={setExamples}
        placeholder="One or more concrete examples that show the right behavior."
        rows={2}
      />

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2.5 py-1 text-[11px] text-muted-soft hover:text-foreground"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !inaccuracyDescription.trim() || !expectedOutcome.trim()}
          className={cn(
            'rounded-md bg-brand-vermilion px-2.5 py-1 text-[11px] font-semibold text-brand-cream transition-colors',
            'hover:bg-brand-vermilion-deep disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {busy ? 'Sending…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

function ReportField({
  label, value, onChange, placeholder, rows, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
  required?: boolean;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.10em] text-muted-soft">
        {label}{required && <span className="ml-1 text-brand-vermilion-soft">*</span>}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={4000}
        className={cn(
          'w-full resize-none rounded-md border border-border bg-brand-teal-deep/60 px-2.5 py-1.5 text-xs text-foreground',
          'placeholder:text-muted-soft focus-visible:outline-none focus-visible:border-brand-sage focus-visible:bg-brand-teal-deep/80',
        )}
      />
    </label>
  );
}

function AssistantBody({ response }: { response: AskResponse }) {
  if (response.intent === 'general') {
    return (
      <div className="whitespace-pre-wrap break-words leading-relaxed">
        {response.answer ?? '(no response)'}
      </div>
    );
  }

  // sql_query or similar_awards
  const showCount = response.intent === 'sql_query' && typeof response.count === 'number';
  const visibleRows = response.rows?.length ?? 0;
  return (
    <div className="space-y-2">
      {response.summary && (
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {response.summary}
        </div>
      )}
      {showCount && (
        <div className="rounded-lg border border-border/70 bg-brand-teal-deep/40 px-3 py-2 text-xs leading-snug">
          <span className="font-mono text-base font-bold tabular-nums text-brand-vermilion-soft">
            {fmtIntCompact(response.count!)}
          </span>
          <span className="ml-2 text-muted-soft">
            {response.count === 1 ? 'matching record' : 'matching records'}
          </span>
          {visibleRows > 0 && response.count! > visibleRows && (
            <span className="ml-2 text-muted-soft">
              · showing first {visibleRows}
            </span>
          )}
        </div>
      )}
      {(response.sql || (response.cols && response.rows)) && (
        <SqlDataDisclosure
          sql={response.sql}
          cols={response.cols}
          rows={response.rows}
          label={response.intent === 'similar_awards' ? 'View results' : 'View SQL / data'}
        />
      )}
      {!response.summary && !response.cols && !showCount && (
        <div className="text-xs text-muted">(no data returned)</div>
      )}
    </div>
  );
}

function fmtIntCompact(n: number): string {
  return n.toLocaleString('en-US');
}

function SqlDataDisclosure({
  sql,
  cols,
  rows,
  label = 'View SQL / data',
}: {
  sql?: string;
  cols?: string[];
  rows?: unknown[][];
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-border/80 bg-brand-teal-deep/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.10em] text-muted hover:text-foreground"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 p-2.5">
          {sql && (
            <pre className="overflow-x-auto rounded border border-border/70 bg-brand-teal-deep/70 p-2 font-mono text-[11px] leading-relaxed text-brand-sage">
              {sql}
            </pre>
          )}
          {cols && rows && rows.length > 0 && (
            <ResultsTable cols={cols} rows={rows} />
          )}
          {cols && rows && rows.length === 0 && (
            <div className="px-1 text-[11px] text-muted">No rows returned.</div>
          )}
        </div>
      )}
    </div>
  );
}

// When `award_id` is among the result columns, each row click opens the
// left-side AwardDetail panel for that award. The chat result row only
// carries ~10 columns from the similar_awards SQL, so we open the panel
// optimistically with partial data, then refetch the full award via
// /awards/:id and merge. If the refetch 404s (award outside the user's
// current scope), the partial data simply stays.
function ResultsTable({ cols, rows }: { cols: string[]; rows: unknown[][] }) {
  const setSelectedAward = useSetSelectedAward();
  const idIndex = cols.indexOf('award_id');
  const rowsClickable = idIndex >= 0;

  function openRow(row: unknown[]) {
    const record: Record<string, unknown> = {};
    cols.forEach((c, k) => { record[c] = row[k]; });
    // The chat similar_awards SQL aliases agency to `agency_name`; the
    // detail panel reads `awarding_agency`. Bridge them so the panel
    // shows a populated Agency section.
    if (record.agency_name && !record.awarding_agency) {
      record.awarding_agency = record.agency_name;
    }
    setSelectedAward(record);

    const id = record.award_id;
    if (typeof id !== 'string' || !id) return;
    api.get<Record<string, unknown>>(`/awards/${encodeURIComponent(id)}`)
      .then((full) => {
        // Functional update guards against the user clicking a different
        // row (or closing the panel) while this fetch was in flight.
        setSelectedAward((prev) => {
          if (!prev || prev.award_id !== id) return prev;
          // Authoritative warehouse fields override the partial chat row,
          // but any chat-only aliases not present in the warehouse row
          // (e.g. `agency_name`) survive via `prev`.
          return { ...prev, ...full };
        });
      })
      .catch(() => { /* out of scope or transient failure — keep partial */ });
  }

  return (
    <div className="overflow-x-auto rounded border border-border/70">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-brand-teal-soft/30 text-left text-muted">
            {cols.map((c) => (
              <th key={c} className="px-2 py-1 font-semibold uppercase tracking-[0.06em]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr
              key={i}
              onClick={rowsClickable ? () => openRow(r) : undefined}
              className={cn(
                'border-t border-border/60',
                rowsClickable && 'cursor-pointer hover:bg-brand-teal-soft/20',
              )}
            >
              {r.map((v, j) => (
                <td
                  key={j}
                  className="px-2 py-1 align-top text-foreground/90 font-variant-numeric tabular-nums"
                >
                  {v === null || v === undefined ? '—' : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <div className="border-t border-border/60 bg-brand-teal-deep/40 px-2 py-1 text-[10px] text-muted">
          Showing first 50 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-brand-sage"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
