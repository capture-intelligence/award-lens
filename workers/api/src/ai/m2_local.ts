/**
 * M2 — Local Reasoner.
 * Calls Fireworks AI serverless with the awards-summarize-lora adapter.
 * Receives question + result rows, returns a natural-language summary.
 * Refuses general-knowledge questions via locked-down system prompt.
 */

const SYSTEM = `You are a federal procurement data analyst. You answer ONLY using the data provided in this conversation. You may summarize, explain trends, compute simple statistics, format tables. You may NOT use external knowledge, make predictions, give opinions, or speculate.

If asked something that requires external knowledge or that the provided data cannot answer, refuse with: "Out of scope — I can only answer from the data shown."

For questions that ARE answerable from the data: write a clear, factual 2-4 sentence answer that cites specific numbers and names. No preamble. No hedging. No "based on the data, ...". Use the same units the question used.`;

export const M2_MODEL_ID = 'algocrat/awards-summarize-lora';

/** Serialize result rows as a compact pipe-delimited text table. */
function serializeResults(cols: string[], rows: unknown[][]): string {
  if (!rows.length) return '(0 rows returned)';

  const MAX_ROWS = 50;
  const MAX_CHARS = 4000;

  let display = rows;
  let note = '';
  if (rows.length > MAX_ROWS) {
    display = rows.slice(0, MAX_ROWS);
    note = `\n(showing ${MAX_ROWS} of ${rows.length} rows)`;
  }

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  };

  const header = cols.join(' | ');
  const body   = display.map(r => (r as unknown[]).map(fmt).join(' | ')).join('\n');
  let text = `${header}\n${body}${note}`;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n...(truncated)';
  return text;
}

export interface M2Result {
  summary: string;
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
}

export async function callM2(
  question: string,
  cols: string[],
  rows: unknown[][],
  ai: Ai,
  modalApiKey?: string,
  modalEndpoint?: string,
): Promise<M2Result> {
  const t0 = Date.now();
  const resultsText = serializeResults(cols, rows);
  const userMsg = `QUESTION:\n${question}\n\nRESULTS:\n${resultsText}`;
  let summary: string;

  if (modalApiKey && modalEndpoint) {
    // Fine-tuned path: Modal Serverless with M2 LoRA adapter (25s timeout, falls back to Workers AI)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let resp: Response;
      try {
        resp = await fetch(modalEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adapter: 'm2',
            api_key: modalApiKey,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user',   content: userMsg },
            ],
            max_tokens: 400,
            temperature: 0.0,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error(`Modal M2 error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json() as { output?: { text?: string }; error?: string };
      if (data.error) throw new Error(`Modal M2 job error: ${data.error}`);
      summary = (data.output?.text ?? '').trim();
    } catch {
      // Modal unavailable or cold-starting — fall through to Workers AI
      const fbResp = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: userMsg },
        ],
        max_tokens: 400,
      } as Parameters<typeof ai.run>[1]);
      summary = ((fbResp as { response?: string }).response ?? '').trim();
    }
  } else {
    // Fallback: Workers AI base model
    const resp = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user',   content: userMsg },
      ],
      max_tokens: 400,
    } as Parameters<typeof ai.run>[1]);
    summary = ((resp as { response?: string }).response ?? '').trim();
  }

  return { summary, promptTokens: 0, outputTokens: 0, durationMs: Date.now() - t0 };
}
