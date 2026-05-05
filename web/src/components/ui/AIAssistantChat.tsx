import * as React from 'react';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AIAssistantChat (#7 in spec shared components) — floating bottom-right
 * button; opens a chat drawer; RAG over current entity's documents +
 * related data.
 *
 * Phase 1 ships a working chat shell. Wire-up to the API's chat endpoint
 * (Workers AI free tier — Llama 3.3 8B) lands once the entity-detail pages
 * are streaming.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export interface AIAssistantChatProps {
  /** What entity does this assistant know about? Sent to the API as RAG context. */
  context?: {
    kind: string;          // 'opportunity' | 'document' | 'awardee' | 'agency'
    id: string;
    title?: string;
  };
  /** Async function the chat calls when the user submits a message. */
  onSendMessage: (text: string, history: ChatMessage[]) => Promise<{ stream: AsyncIterable<string> } | { content: string }>;
  /** Pre-canned prompts shown above the input box. */
  suggestedPrompts?: string[];
  /** Title shown in the panel header. */
  title?: string;
}

export function AIAssistantChat({
  context, onSendMessage, suggestedPrompts, title = 'CaptureRadar Assistant',
}: AIAssistantChatProps) {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9 });
  }, [messages]);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    const userMsg: ChatMessage = { id: rid(), role: 'user', content: text.trim() };
    const assistantMsg: ChatMessage = { id: rid(), role: 'assistant', content: '', isStreaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput('');
    setBusy(true);

    try {
      const result = await onSendMessage(text.trim(), messages);
      if ('stream' in result) {
        let acc = '';
        for await (const chunk of result.stream) {
          acc += chunk;
          setMessages((m) => m.map((x) => x.id === assistantMsg.id ? { ...x, content: acc } : x));
        }
      } else {
        setMessages((m) => m.map((x) => x.id === assistantMsg.id ? { ...x, content: result.content } : x));
      }
    } catch (e) {
      setMessages((m) => m.map((x) =>
        x.id === assistantMsg.id
          ? { ...x, content: `_Error: ${e instanceof Error ? e.message : 'unknown'}_`, isStreaming: false }
          : x,
      ));
    } finally {
      setMessages((m) => m.map((x) => x.id === assistantMsg.id ? { ...x, isStreaming: false } : x));
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating launcher (bottom-right) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft text-foreground shadow-lg shadow-brand-vermilion/30 transition-transform hover:scale-105"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      {/* Drawer */}
      {open && (
        <aside className="fixed bottom-6 right-6 z-40 flex h-[calc(100dvh-6rem)] max-h-[640px] w-[min(420px,calc(100vw-3rem))] flex-col rounded-2xl border border-border bg-brand-teal-deep/95 shadow-glass-lg backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-vermilion/15 text-brand-vermilion-soft ring-1 ring-brand-vermilion/30">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="text-sm font-semibold leading-tight">{title}</div>
                {context && (
                  <div className="text-[10px] uppercase tracking-[0.10em] text-muted-soft">
                    {context.kind} · {context.title ?? context.id}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-md p-1 text-muted-soft transition-colors hover:bg-brand-teal-soft/20 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* Message list */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">
                  Ask about this {context?.kind ?? 'entity'} — incumbents, value, due dates, similar opportunities, or anything else.
                </p>
                {suggestedPrompts && suggestedPrompts.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {suggestedPrompts.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => submit(p)}
                          className="w-full rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-left text-[12px] text-muted transition-colors hover:border-brand-vermilion/40 hover:bg-brand-teal-soft/20 hover:text-foreground"
                        >
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm leading-relaxed',
                      m.role === 'user'
                        ? 'self-end bg-brand-vermilion/15 text-foreground ring-1 ring-brand-vermilion/30'
                        : 'self-start bg-brand-teal-soft/15 text-foreground ring-1 ring-border/50',
                    )}
                  >
                    {m.content || (m.isStreaming
                      ? <Loader2 className="h-3 w-3 animate-spin text-muted-soft" />
                      : null)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); submit(input); }}
            className="flex items-center gap-2 border-t border-border/60 p-3"
          >
            <input
              type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…" disabled={busy}
              className="flex-1 rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-soft/70 focus:border-brand-vermilion focus:outline-none focus:ring-2 focus:ring-brand-vermilion/30 disabled:opacity-50"
            />
            <button
              type="submit" disabled={busy || !input.trim()}
              className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft text-foreground transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </aside>
      )}
    </>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}
