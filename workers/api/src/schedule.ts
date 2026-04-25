/**
 * Schedule catalog — VM systemd timers (Path B).
 *
 * All ingestion now runs from the Oracle Cloud sidecar VM, not Cloudflare.
 * This catalog mirrors the *.timer files in sidecar-oracle/systemd/ for the
 * Schedule tab's "next run" estimation.
 *
 * Keep in sync with sidecar-oracle/systemd/awards-*.timer.
 */

export type Health = 'healthy' | 'stale' | 'running' | 'never_run' | 'error' | 'disabled';

export interface ScheduleDef {
  source_id: string;
  display_name: string;
  cron: string;
  interval_human: string;
  enabled: boolean;
  stale_threshold_hours: number;
  nextFire(now: Date): Date;
}

// Helper: next "today at HH:MM UTC" (or tomorrow if already past).
function nextDaily(hour: number, minute: number) {
  return (now: Date): Date => {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      hour, minute, 0, 0,
    ));
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };
}

// Helper: next "weekly, DOW=sunday(0)..saturday(6), HH:MM UTC".
function nextWeekly(dow: number, hour: number, minute: number) {
  return (now: Date): Date => {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      hour, minute, 0, 0,
    ));
    const currentDow = d.getUTCDay();
    let diff = (dow - currentDow + 7) % 7;
    if (diff === 0 && d.getTime() <= now.getTime()) diff = 7;
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  };
}

export const SCHEDULES: ScheduleDef[] = [
  {
    source_id: 'usaspending',
    display_name: 'USAspending.gov (incremental)',
    cron: '0 6 * * *',
    interval_human: 'Daily at 06:00 UTC',
    enabled: true,
    stale_threshold_hours: 28,
    nextFire: nextDaily(6, 0),
  },
  {
    source_id: 'sam_bulk',
    display_name: 'SAM.gov bulk (exclusions)',
    cron: '(disabled — URL needs maintenance)',
    interval_human: 'On-demand (sidecar script not yet built)',
    enabled: false,
    stale_threshold_hours: 24 * 365,
    nextFire: () => new Date(0),
  },
  {
    source_id: 'grants_gov',
    display_name: 'Grants.gov opportunities',
    cron: '30 8 * * *',
    interval_human: 'Daily at 08:30 UTC',
    enabled: true,
    stale_threshold_hours: 28,
    nextFire: nextDaily(8, 30),
  },
  {
    source_id: 'reconciliation',
    display_name: 'Reconciliation audit',
    cron: '0 12 * * SUN',
    interval_human: 'Weekly — Sunday at 12:00 UTC',
    enabled: true,
    stale_threshold_hours: 24 * 8,
    nextFire: nextWeekly(0, 12, 0),
  },
  {
    source_id: 'sam_api',
    display_name: 'SAM.gov API (on-demand)',
    cron: '(none — on-demand)',
    interval_human: 'On-demand via dashboard "Enrich" button',
    enabled: false,
    stale_threshold_hours: 24 * 365,
    nextFire: () => new Date(0),
  },
];

export interface ScheduleStatusRow {
  source_id: string;
  display_name: string;
  cron: string;
  interval_human: string;
  enabled: boolean;
  stale_threshold_hours: number;
  last_run: {
    run_id: number;
    started_at: string;
    finished_at: string | null;
    status: string;
    rows_upserted: number;
    rows_fetched: number;
  } | null;
  currently_running: boolean;
  next_run_estimated: string | null;
  hours_since_last_run: number | null;
  health: Health;
  health_reason: string;
}

export async function buildScheduleStatus(db: D1Database): Promise<ScheduleStatusRow[]> {
  const now = new Date();

  // Latest run per source (single D1 round-trip)
  const lastRuns = await db.prepare(`
    SELECT r.*
    FROM ingestion_run r
    INNER JOIN (
      SELECT source_id, MAX(run_id) AS max_id
      FROM ingestion_run
      GROUP BY source_id
    ) x ON x.source_id = r.source_id AND x.max_id = r.run_id
  `).all<{
    run_id: number;
    source_id: string;
    started_at: string;
    finished_at: string | null;
    status: string;
    rows_upserted: number;
    rows_fetched: number;
  }>();

  const byId = new Map(lastRuns.results.map((r) => [r.source_id, r]));

  // Any currently-running runs
  const running = await db.prepare(
    `SELECT source_id FROM ingestion_run WHERE status = 'running'`,
  ).all<{ source_id: string }>();
  const runningSet = new Set(running.results.map((r) => r.source_id));

  return SCHEDULES.map((s) => {
    const last = byId.get(s.source_id) ?? null;
    const isRunning = runningSet.has(s.source_id);

    const lastTs = last ? Date.parse(last.started_at) : null;
    const hoursSince = lastTs ? (now.getTime() - lastTs) / 3_600_000 : null;

    let health: Health;
    let reason: string;

    if (!s.enabled) {
      health = 'disabled';
      reason = 'Scheduled refresh disabled (on-demand only)';
    } else if (isRunning) {
      health = 'running';
      reason = 'A run is currently in progress';
    } else if (!last) {
      health = 'never_run';
      reason = 'No ingestion runs recorded yet';
    } else if (last.status === 'failed') {
      health = 'error';
      reason = `Last run failed at ${last.finished_at ?? last.started_at}`;
    } else if (hoursSince !== null && hoursSince > s.stale_threshold_hours) {
      health = 'stale';
      reason = `${hoursSince.toFixed(1)}h since last run (threshold ${s.stale_threshold_hours}h)`;
    } else {
      health = 'healthy';
      reason = `Last success ${hoursSince?.toFixed(1)}h ago`;
    }

    return {
      source_id: s.source_id,
      display_name: s.display_name,
      cron: s.cron,
      interval_human: s.interval_human,
      enabled: s.enabled,
      stale_threshold_hours: s.stale_threshold_hours,
      last_run: last
        ? {
            run_id: last.run_id,
            started_at: last.started_at,
            finished_at: last.finished_at,
            status: last.status,
            rows_upserted: last.rows_upserted,
            rows_fetched: last.rows_fetched,
          }
        : null,
      currently_running: isRunning,
      next_run_estimated: s.enabled ? s.nextFire(now).toISOString() : null,
      hours_since_last_run: hoursSince,
      health,
      health_reason: reason,
    };
  });
}
