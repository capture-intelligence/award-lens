import * as React from 'react';
import { ChevronDown, ChevronRight, X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * FilterPanel (#2 in spec shared components) — collapsible panel; Quick
 * Filters section (boolean toggles); Search Filters section (multi-select,
 * date-range, text, range slider); applied filters shown as removable chips;
 * Clear All action.
 *
 * Stays generic — each list page passes a config + value object, the panel
 * renders the controls and emits onChange with the merged state.
 */

// ─── Filter type definitions ───────────────────────────────────────────────

export type QuickFilter = {
  id: string;
  label: string;
  description?: string;
};

export type SearchFilter =
  | { id: string; label: string; type: 'text'; placeholder?: string }
  | { id: string; label: string; type: 'multi-select'; options: { value: string; label: string }[]; searchable?: boolean }
  | { id: string; label: string; type: 'date-range' }
  | { id: string; label: string; type: 'number-range'; min?: number; max?: number; format?: 'currency' | 'integer' };

export type FilterValue =
  | { kind: 'text'; value: string }
  | { kind: 'multi'; values: string[] }
  | { kind: 'date-range'; from?: string; to?: string }
  | { kind: 'number-range'; min?: number; max?: number };

export type FilterState = {
  quick: Record<string, boolean>;
  search: Record<string, FilterValue>;
};

export interface FilterPanelProps {
  quickFilters: QuickFilter[];
  searchFilters: SearchFilter[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  onReset?: () => void;
  className?: string;
}

export function FilterPanel({
  quickFilters,
  searchFilters,
  value,
  onChange,
  onReset,
  className,
}: FilterPanelProps) {
  const [expanded, setExpanded] = React.useState({ quick: true, search: true });

  const setQuick = (id: string, v: boolean) =>
    onChange({ ...value, quick: { ...value.quick, [id]: v } });

  const setSearch = (id: string, v: FilterValue) =>
    onChange({ ...value, search: { ...value.search, [id]: v } });

  const clearOne = (id: string) => {
    const next = { ...value.search };
    delete next[id];
    onChange({ ...value, search: next });
  };

  const appliedChips: { id: string; label: string }[] = [];
  for (const [id, fv] of Object.entries(value.search)) {
    const cfg = searchFilters.find((f) => f.id === id);
    if (!cfg) continue;
    const label = describeValue(cfg, fv);
    if (label) appliedChips.push({ id, label: `${cfg.label}: ${label}` });
  }
  for (const [id, on] of Object.entries(value.quick)) {
    if (on) {
      const cfg = quickFilters.find((q) => q.id === id);
      if (cfg) appliedChips.push({ id: `q:${id}`, label: cfg.label });
    }
  }

  return (
    <aside
      className={cn(
        'flex w-full max-w-[320px] flex-col gap-3 rounded-xl border border-border bg-brand-teal-deep/30 p-3 text-sm',
        className,
      )}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-soft">
          Filters
        </h2>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-soft transition-colors hover:bg-brand-teal-soft/20 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Clear all
          </button>
        )}
      </header>

      {appliedChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-y border-border/60 py-2">
          {appliedChips.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-brand-vermilion/15 px-2 py-0.5 text-[11px] font-medium text-brand-vermilion-soft ring-1 ring-brand-vermilion/30"
            >
              {c.label}
              <button
                type="button"
                aria-label={`Remove ${c.label}`}
                onClick={() => {
                  if (c.id.startsWith('q:')) setQuick(c.id.slice(2), false);
                  else clearOne(c.id);
                }}
                className="rounded-full p-0.5 transition-colors hover:bg-brand-vermilion/30"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Section
        title="Quick filters"
        open={expanded.quick}
        onToggle={() => setExpanded((s) => ({ ...s, quick: !s.quick }))}
      >
        <ul className="flex flex-col gap-1">
          {quickFilters.map((f) => (
            <li key={f.id}>
              <label
                title={f.description}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-foreground transition-colors hover:bg-brand-teal-soft/20"
              >
                <input
                  type="checkbox"
                  checked={!!value.quick[f.id]}
                  onChange={(e) => setQuick(f.id, e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-brand-vermilion"
                />
                <span className="text-[13px]">{f.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Search filters"
        open={expanded.search}
        onToggle={() => setExpanded((s) => ({ ...s, search: !s.search }))}
      >
        <div className="flex flex-col gap-3">
          {searchFilters.map((f) => (
            <FilterControl
              key={f.id}
              filter={f}
              value={value.search[f.id]}
              onChange={(v) => setSearch(f.id, v)}
            />
          ))}
        </div>
      </Section>
    </aside>
  );
}

// ─── Inner pieces ──────────────────────────────────────────────────────────

function Section({
  title, open, onToggle, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-soft transition-colors hover:text-foreground"
      >
        {title}
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

function FilterControl({
  filter, value, onChange,
}: {
  filter: SearchFilter;
  value?: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (filter.type === 'text') {
    const v = value?.kind === 'text' ? value.value : '';
    return (
      <Field label={filter.label}>
        <input
          type="text"
          value={v}
          placeholder={filter.placeholder}
          onChange={(e) => onChange({ kind: 'text', value: e.target.value })}
          className="w-full rounded-md border border-border bg-brand-teal-deep/30 px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-soft/70 focus:border-brand-vermilion focus:outline-none focus:ring-2 focus:ring-brand-vermilion/30"
        />
      </Field>
    );
  }

  if (filter.type === 'date-range') {
    const v = value?.kind === 'date-range' ? value : { kind: 'date-range' as const };
    return (
      <Field label={filter.label}>
        <div className="flex gap-2">
          <input
            type="date"
            value={v.from ?? ''}
            onChange={(e) => onChange({ ...v, kind: 'date-range', from: e.target.value || undefined })}
            className="flex-1 rounded-md border border-border bg-brand-teal-deep/30 px-2 py-1.5 text-[12px] text-foreground"
          />
          <input
            type="date"
            value={v.to ?? ''}
            onChange={(e) => onChange({ ...v, kind: 'date-range', to: e.target.value || undefined })}
            className="flex-1 rounded-md border border-border bg-brand-teal-deep/30 px-2 py-1.5 text-[12px] text-foreground"
          />
        </div>
      </Field>
    );
  }

  if (filter.type === 'number-range') {
    const v = value?.kind === 'number-range' ? value : { kind: 'number-range' as const };
    return (
      <Field label={filter.label}>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            value={v.min ?? ''}
            min={filter.min} max={filter.max}
            onChange={(e) => onChange({ ...v, kind: 'number-range', min: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="flex-1 rounded-md border border-border bg-brand-teal-deep/30 px-2 py-1.5 text-[12px] text-foreground"
          />
          <input
            type="number"
            placeholder="Max"
            value={v.max ?? ''}
            min={filter.min} max={filter.max}
            onChange={(e) => onChange({ ...v, kind: 'number-range', max: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="flex-1 rounded-md border border-border bg-brand-teal-deep/30 px-2 py-1.5 text-[12px] text-foreground"
          />
        </div>
      </Field>
    );
  }

  // multi-select — minimal native checkbox list (Radix Select Phase 1.5)
  if (filter.type === 'multi-select') {
    const selected = new Set(value?.kind === 'multi' ? value.values : []);
    return (
      <Field label={filter.label}>
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-brand-teal-deep/30 p-1">
          {filter.options.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-[12px] hover:bg-brand-teal-soft/20"
            >
              <input
                type="checkbox"
                checked={selected.has(opt.value)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(opt.value); else next.delete(opt.value);
                  onChange({ kind: 'multi', values: [...next] });
                }}
                className="h-3 w-3 accent-brand-vermilion"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </Field>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.10em] text-muted-soft">
        {label}
      </span>
      {children}
    </div>
  );
}

function describeValue(cfg: SearchFilter, fv: FilterValue): string | null {
  if (cfg.type === 'text'         && fv.kind === 'text')         return fv.value || null;
  if (cfg.type === 'date-range'   && fv.kind === 'date-range')   return [fv.from, fv.to].filter(Boolean).join(' → ') || null;
  if (cfg.type === 'number-range' && fv.kind === 'number-range') return [fv.min, fv.max].map((x) => x ?? '–').join(' to ');
  if (cfg.type === 'multi-select' && fv.kind === 'multi')        return fv.values.length ? `${fv.values.length} selected` : null;
  return null;
}
