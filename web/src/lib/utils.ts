import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merger. Used by all primitives. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return String(s).slice(0, 10);
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return String(s).replace('T', ' ').slice(0, 19);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((target - now) / 1000);
  const abs = Math.abs(diffSec);
  const future = diffSec > 0;
  if (abs < 60) return future ? `in ${abs}s` : `${abs}s ago`;
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.round((abs % 3600) / 60);
    return future ? `in ${h}h ${m}m` : `${h}h ${m}m ago`;
  }
  const d = Math.round(abs / 86400);
  return future ? `in ${d}d` : `${d}d ago`;
}

export function initials(s: string | null | undefined): string {
  if (!s) return '?';
  const parts = String(s).trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}
