/**
 * M3 — External Generalist.
 * Calls the Anthropic API (claude-sonnet-4-5) for general-knowledge questions
 * and for interpreting the public metadata of a focused award.
 *
 * Privacy contract: M3 may receive a small set of PUBLIC award fields
 * (award_id, description, naics_code, psc_code, psc_description) when the
 * user is viewing a specific award. These come straight from
 * USAspending.gov, which is itself a public dataset. M3 never sees private
 * vendor scoring, internal notes, or any field flagged INTERNAL — see
 * MODEL-ROUTING.md §2.
 */

import type { AwardContext } from './types.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const M3_MODEL_ID = 'claude-sonnet-4-5';

const SYSTEM = `You are a helpful assistant embedded in a federal procurement dashboard. You answer general questions about federal contracting, acquisition regulations, agency structures, and procurement concepts.

When the user is viewing a specific award, the message will include a "FOCUSED AWARD" block with public metadata for that award (description, NAICS code, PSC code, PSC description). You may discuss this freely — it's all from USAspending.gov public records. Use it to interpret what the contract is about, what category of work it covers, and what kind of vendor would typically perform it.

For warehouse-wide statistical questions ("how many awards does NASA have?") tell the user to ask about their data directly — those go to a different model.

Be concise. Cite regulation numbers (FAR, DFARS, etc.) when relevant.`;

export interface M3Result {
  answer: string;
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
}

function formatContext(ctx: AwardContext): string {
  const lines: string[] = ['FOCUSED AWARD:'];
  if (ctx.description)     lines.push(`Description: ${ctx.description}`);
  if (ctx.naics_code)      lines.push(`NAICS code: ${ctx.naics_code}`);
  if (ctx.psc_code)        lines.push(`PSC code: ${ctx.psc_code}`);
  if (ctx.psc_description) lines.push(`PSC description: ${ctx.psc_description}`);
  return lines.join('\n');
}

export async function callM3(
  question: string,
  apiKey: string,
  awardContext?: AwardContext | null,
): Promise<M3Result> {
  const t0 = Date.now();

  const userMsg = awardContext
    ? `${formatContext(awardContext)}\n\nQuestion: ${question}`
    : question;

  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      M3_MODEL_ID,
      max_tokens: 1024,
      system:     SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`M3 Anthropic error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    content: { type: string; text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  const answer = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    answer,
    promptTokens: data.usage?.input_tokens  ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    durationMs:   Date.now() - t0,
  };
}
