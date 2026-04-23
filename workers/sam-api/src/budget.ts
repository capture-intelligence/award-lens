/**
 * SamApiBudget — a global Durable Object that tracks SAM.gov API calls
 * against the 10/day public-tier quota.
 *
 * All workers that want to hit the SAM API must acquire a budget slot first,
 * which prevents race conditions between the queue consumer, the optional
 * cron, and any ad-hoc HTTP trigger.
 *
 * The counter is keyed by UTC date so it resets cleanly at 00:00 UTC.
 */

export interface BudgetStatus {
  used: number;
  limit: number;
  remaining: number;
  dateKey: string;
  resetsAt: string;  // ISO time when counter will reset
}

export class SamApiBudget implements DurableObject {
  state: DurableObjectState;
  DAILY_LIMIT = 10;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/acquire': return this.acquire(request);
      case '/status':  return Response.json(await this.status());
      case '/release': return this.release(request);
      default:         return new Response('not found', { status: 404 });
    }
  }

  private dateKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private resetsAt(): string {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.toISOString();
  }

  private async currentUsed(): Promise<number> {
    return (await this.state.storage.get<number>(`budget:${this.dateKey()}`)) ?? 0;
  }

  async status(): Promise<BudgetStatus> {
    const used = await this.currentUsed();
    return {
      used,
      limit: this.DAILY_LIMIT,
      remaining: Math.max(0, this.DAILY_LIMIT - used),
      dateKey: this.dateKey(),
      resetsAt: this.resetsAt(),
    };
  }

  async acquire(request: Request): Promise<Response> {
    // Optional ?n=K to acquire multiple slots atomically (for batched calls)
    const url = new URL(request.url);
    const n = Math.max(1, Math.min(Number(url.searchParams.get('n') ?? 1), this.DAILY_LIMIT));

    const key = `budget:${this.dateKey()}`;
    const used = await this.currentUsed();
    if (used + n > this.DAILY_LIMIT) {
      return Response.json(
        { granted: false, used, limit: this.DAILY_LIMIT, resetsAt: this.resetsAt() },
        { status: 429 },
      );
    }
    await this.state.storage.put(key, used + n);
    return Response.json({ granted: true, acquired: n, used: used + n, limit: this.DAILY_LIMIT });
  }

  async release(request: Request): Promise<Response> {
    // If a call failed and we want to return the slot, call /release?n=K
    const url = new URL(request.url);
    const n = Math.max(1, Number(url.searchParams.get('n') ?? 1));
    const used = await this.currentUsed();
    await this.state.storage.put(`budget:${this.dateKey()}`, Math.max(0, used - n));
    return Response.json({ released: n });
  }
}
