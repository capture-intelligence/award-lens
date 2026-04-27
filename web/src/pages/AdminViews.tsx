import * as React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus, Edit3, Trash2, Database, Power, PowerOff,
  Play, RotateCcw, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Label, Select } from '@/components/ui/Input';
import { TOPTIERS, subtiersFor } from '@/lib/agencies';
import {
  AWARD_TYPES, AWARD_TYPE_GROUPS, DEFAULT_AWARD_TYPES,
  LOOKBACK_PRESETS, FORWARD_PRESETS,
} from '@/lib/award-types';
import { US_STATES, stateName } from '@/lib/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  EmptyState,
} from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViews } from '@/lib/view-context';
import { fmtDate, fmtInt, relativeTime } from '@/lib/utils';
import type { DataView, ViewFilters } from '@/lib/views';
import { PageHeader } from '@/components/ui/PageHeader';

interface AdminViewRow extends DataView {
  enabled: boolean;
}

interface ViewRunRequest {
  request_id: string;
  view_id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  attempt: number;
  max_attempts: number;
  requested_at: string;
  next_attempt_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_id: number | null;
  error_message: string | null;
}

export function AdminViewsPage() {
  const { refresh: refreshViews } = useViews();
  const [rows, setRows] = React.useState<AdminViewRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);
  const [editing, setEditing] = React.useState<AdminViewRow | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: AdminViewRow[] }>('/admin/views');
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const reload = () => { setToken((n) => n + 1); void refreshViews(); };

  async function toggleEnabled(v: AdminViewRow) {
    try {
      await api.put(`/admin/views/${v.view_id}`, { enabled: !v.enabled });
      toast.success(`View ${v.enabled ? 'paused' : 'resumed'}`);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Update failed');
    }
  }

  async function deleteView(v: AdminViewRow) {
    if (!confirm(`Delete view "${v.name}"? This removes user access grants and view-award tags but keeps the underlying award rows.`)) return;
    try {
      await api.del(`/admin/views/${v.view_id}`);
      toast.success(`Deleted ${v.name}`);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Delete failed');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Views"
        description="Curated slices of federal award data. Each view defines an ingestion scope and an access boundary for users."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> New view
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {rows === null ? (
            <TableSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState>
              <Database className="mx-auto mb-2 h-6 w-6 text-brand-sage" />
              No views yet. Create one to define an ingestion + access scope.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>View</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => (
                  <TableRow key={v.view_id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{v.name}</div>
                      {v.description && (
                        <div className="text-xs text-muted-soft">{v.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <ScopeSummary filters={v.filters} />
                    </TableCell>
                    <TableCell>
                      {v.enabled ? (
                        <Badge variant="success">Enabled</Badge>
                      ) : (
                        <Badge variant="ghost">Paused</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <RunStatusCell viewId={v.view_id} reloadKey={token} />
                    </TableCell>
                    <TableCell className="text-xs text-muted">
                      {fmtDate(v.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <RunNowButton viewId={v.view_id} enabled={v.enabled} onTriggered={reload} />
                        <Button variant="ghost" size="sm" onClick={() => toggleEnabled(v)}>
                          {v.enabled
                            ? <><PowerOff className="mr-1 h-4 w-4" /> Pause</>
                            : <><Power    className="mr-1 h-4 w-4" /> Enable</>}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setEditing(v)}>
                          <Edit3 className="mr-1 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => deleteView(v)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </motion.div>

      {(creating || editing) && (
        <ViewEditorModal
          view={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Run status + Run Now ────────────────────────────────────────────────────

function RunStatusCell({ viewId, reloadKey }: { viewId: string; reloadKey: number }) {
  const [latest, setLatest] = React.useState<ViewRunRequest | null | undefined>(undefined);
  // Poll while a request is pending or running.
  React.useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const r = await api.get<{ results: ViewRunRequest[] }>(`/admin/views/${viewId}/runs`);
        const newest = r.results?.[0] ?? null;
        if (!alive) return;
        setLatest(newest);
        const isLive = newest && (newest.status === 'pending' || newest.status === 'running');
        if (isLive) t = setTimeout(tick, 5_000);
      } catch {
        if (alive) setLatest(null);
      }
    }
    void tick();
    return () => { alive = false; if (t) clearTimeout(t); };
  }, [viewId, reloadKey]);

  if (latest === undefined) {
    return <span className="text-[11px] text-muted-soft">Loading…</span>;
  }
  if (latest === null) {
    return <span className="text-[11px] text-muted-soft">Never</span>;
  }
  return <RunStatusBadge req={latest} />;
}

function RunStatusBadge({ req }: { req: ViewRunRequest }) {
  if (req.status === 'running') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-warning">
          <Clock className="h-3 w-3 animate-pulse" /> Running
        </span>
        <span className="text-[10px] text-muted-soft">
          attempt {req.attempt}/{req.max_attempts}
        </span>
      </div>
    );
  }
  if (req.status === 'pending') {
    const queued = new Date(req.next_attempt_at).getTime() <= Date.now();
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-brand-sage/30 bg-brand-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-sage">
          <Clock className="h-3 w-3" /> {queued ? 'Queued' : 'Retrying'}
        </span>
        <span className="text-[10px] text-muted-soft">
          {queued ? `attempt ${req.attempt + 1}` : `next ${relativeTime(req.next_attempt_at)} (#${req.attempt + 1})`}
        </span>
      </div>
    );
  }
  if (req.status === 'success') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-success">
          <CheckCircle2 className="h-3 w-3" /> Success
        </span>
        <span className="text-[10px] text-muted-soft">
          {req.finished_at ? relativeTime(req.finished_at) : '—'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1 rounded-full border border-brand-vermilion/30 bg-brand-vermilion/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-vermilion-soft"
        title={req.error_message ?? ''}
      >
        <XCircle className="h-3 w-3" /> Failed
      </span>
      <span className="text-[10px] text-muted-soft">
        after {req.attempt}/{req.max_attempts} {req.finished_at ? `· ${relativeTime(req.finished_at)}` : ''}
      </span>
    </div>
  );
}

function RunNowButton({
  viewId, enabled, onTriggered,
}: {
  viewId: string;
  enabled: boolean;
  onTriggered: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  async function trigger() {
    if (!enabled) {
      toast.error('Enable the view first');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ request_id: string; status: string; deduped?: boolean }>(
        `/admin/views/${viewId}/run`,
      );
      toast.success(
        r.deduped
          ? 'A run is already queued for this view'
          : 'Run queued — sidecar will pick it up within ~60s',
      );
      onTriggered();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Trigger failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="success" size="sm" onClick={trigger} disabled={busy || !enabled}>
      {busy
        ? <><RotateCcw className="mr-1 h-4 w-4 animate-spin" /> Queuing…</>
        : <><Play       className="mr-1 h-4 w-4" /> Run now</>}
    </Button>
  );
}

function formatValueRange(min?: number, max?: number): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `$${fmtInt(min)} – $${fmtInt(max)}`;
  if (min != null) return `≥ $${fmtInt(min)}`;
  return `≤ $${fmtInt(max!)}`;
}

function ScopeSummary({ filters }: { filters: ViewFilters }) {
  const chips: string[] = [];
  if (filters.toptier_agency_name) {
    const top = TOPTIERS.find((t) => t.name === filters.toptier_agency_name);
    chips.push(top?.abbrev ?? filters.toptier_agency_name);
  }
  if (filters.subtier_agency_name) {
    const sub = subtiersFor(filters.toptier_agency_name).find((s) => s.name === filters.subtier_agency_name);
    chips.push(sub?.abbrev ?? filters.subtier_agency_name);
  }
  if (filters.office_codes?.length) chips.push(`Offices: ${filters.office_codes.join(', ')}`);
  if (filters.keywords?.length)     chips.push(`Keywords: ${filters.keywords.join(', ')}`);
  if (filters.naics_codes?.length)  chips.push(`NAICS: ${filters.naics_codes.join(', ')}`);
  if (filters.psc_codes?.length)    chips.push(`PSC: ${filters.psc_codes.join(', ')}`);
  if (filters.award_types?.length)  chips.push(`Types: ${filters.award_types.join(', ')}`);
  if (filters.pop_states?.length)   chips.push(`PoP: ${filters.pop_states.join(', ')}`);
  const valueChip = formatValueRange(filters.min_value, filters.max_value);
  if (valueChip)                    chips.push(valueChip);
  // End-date window: "−18mo / +6mo" or just "−18mo" / "+6mo" if one bound.
  const lb = filters.lookback_months;
  const fw = filters.forward_months;
  if (lb && fw)       chips.push(`End: −${lb}mo / +${fw}mo`);
  else if (lb)        chips.push(`End: −${lb}mo`);
  else if (fw)        chips.push(`End: +${fw}mo`);
  if (chips.length === 0) return <span className="text-muted-soft">No filters</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="rounded-md border border-border bg-brand-teal-deep/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted">
          {c}
        </span>
      ))}
    </div>
  );
}

// ─── Editor Modal ────────────────────────────────────────────────────────────

function ViewEditorModal({
  view, onClose, onSaved,
}: {
  view: AdminViewRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!view;
  const [name, setName] = React.useState(view?.name ?? '');
  const [description, setDescription] = React.useState(view?.description ?? '');
  const [enabled, setEnabled] = React.useState(view?.enabled ?? true);
  const [toptier, setToptier] = React.useState(view?.filters.toptier_agency_name ?? '');
  const [subtier, setSubtier] = React.useState(view?.filters.subtier_agency_name ?? '');
  const [offices, setOffices] = React.useState((view?.filters.office_codes ?? []).join(', '));
  const [keywords, setKeywords] = React.useState((view?.filters.keywords ?? []).join(', '));
  const [naics, setNaics] = React.useState((view?.filters.naics_codes ?? []).join(', '));
  const [psc, setPsc] = React.useState((view?.filters.psc_codes ?? []).join(', '));
  const [awardTypeCodes, setAwardTypeCodes] = React.useState<string[]>(
    view?.filters.award_types ?? DEFAULT_AWARD_TYPES,
  );
  const [popStates, setPopStates] = React.useState<string[]>(view?.filters.pop_states ?? []);
  const [stateSearch, setStateSearch] = React.useState('');
  const [minValue, setMinValue] = React.useState(String(view?.filters.min_value ?? ''));
  const [maxValue, setMaxValue] = React.useState(String(view?.filters.max_value ?? ''));
  const [lookbackMonths, setLookbackMonths] = React.useState(String(view?.filters.lookback_months ?? '18'));
  const [forwardMonths,  setForwardMonths]  = React.useState(String(view?.filters.forward_months  ?? '6'));
  const [saving, setSaving] = React.useState(false);

  // When toptier changes, clear subtier if it no longer belongs.
  const subtierOptions = subtiersFor(toptier);
  React.useEffect(() => {
    if (subtier && !subtierOptions.find((s) => s.name === subtier)) setSubtier('');
  }, [toptier]); // eslint-disable-line react-hooks/exhaustive-deps

  function splitCsv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
  }

  function toggleAwardType(code: string) {
    setAwardTypeCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function togglePopState(code: string) {
    setPopStates((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  const filteredStates = React.useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    if (!q) return US_STATES;
    return US_STATES.filter(
      (s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
    );
  }, [stateSearch]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);

    const filters: ViewFilters = {};
    if (toptier.trim())              filters.toptier_agency_name = toptier.trim();
    if (subtier.trim())              filters.subtier_agency_name = subtier.trim();
    if (offices.trim())              filters.office_codes = splitCsv(offices);
    if (keywords.trim())             filters.keywords     = splitCsv(keywords);
    if (naics.trim())                filters.naics_codes  = splitCsv(naics);
    if (psc.trim())                  filters.psc_codes    = splitCsv(psc);
    if (awardTypeCodes.length)       filters.award_types  = awardTypeCodes;
    if (popStates.length)            filters.pop_states   = popStates;
    if (minValue.trim())             filters.min_value    = Number(minValue);
    if (maxValue.trim())             filters.max_value    = Number(maxValue);
    if (lookbackMonths.trim())       filters.lookback_months = Number(lookbackMonths);
    if (forwardMonths.trim())        filters.forward_months  = Number(forwardMonths);

    // Sanity: if both are set, min must be ≤ max.
    if (filters.min_value != null && filters.max_value != null && filters.min_value > filters.max_value) {
      setSaving(false);
      return toast.error('Minimum value cannot be greater than maximum value');
    }

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      enabled,
      filters,
    };

    try {
      if (isEdit) await api.put(`/admin/views/${view!.view_id}`, body);
      else        await api.post('/admin/views', body);
      toast.success(isEdit ? 'View updated' : 'View created');
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : (e instanceof Error ? e.message : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-6 py-12 backdrop-blur-sm">
      <motion.form
        onSubmit={save}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="glass max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border p-8 shadow-glass-lg"
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-sage">
          {isEdit ? 'Edit view' : 'New view'}
        </div>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">
          {isEdit ? `Edit "${view!.name}"` : 'Create scoped view'}
        </h2>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CDC / NCHS" />
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional helper text shown to users browsing views" />
          </div>

          <div>
            <Label>Toptier agency</Label>
            <Select value={toptier} onChange={(e) => setToptier(e.target.value)}>
              <option value="">— Any agency —</option>
              {TOPTIERS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.abbrev} — {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Subtier (bureau)</Label>
            <Select
              value={subtier}
              onChange={(e) => setSubtier(e.target.value)}
              disabled={!toptier || subtierOptions.length === 0}
            >
              <option value="">
                {!toptier
                  ? '— Pick a toptier first —'
                  : subtierOptions.length === 0
                    ? '— No subtiers listed for this toptier —'
                    : '— All subtiers —'}
              </option>
              {subtierOptions.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.abbrev} — {s.name}
                </option>
              ))}
            </Select>
            {toptier && subtierOptions.length === 0 && (
              <div className="mt-1 text-[10px] text-muted-soft">
                Use Keywords below to scope by sub-organization for this agency.
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <Label>Office codes (comma-separated)</Label>
            <Input value={offices} onChange={(e) => setOffices(e.target.value)} placeholder="HHSA200, HHSF223…" />
          </div>
          <div className="md:col-span-2">
            <Label>Keywords (comma-separated)</Label>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="NCHS, OLSR, Vital Statistics" />
            <div className="mt-1 text-[10px] text-muted-soft">
              For office-level scoping when USAspending doesn't expose office codes — matches awarding office name OR description.
            </div>
          </div>

          <div>
            <Label>NAICS codes</Label>
            <Input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="541611, 541512" />
          </div>
          <div>
            <Label>PSC codes</Label>
            <Input value={psc} onChange={(e) => setPsc(e.target.value)} placeholder="R408, R499" />
          </div>

          <div className="md:col-span-2">
            <Label>Award types</Label>
            <div className="space-y-3 rounded-lg border border-border bg-brand-teal-deep/40 p-3">
              {AWARD_TYPE_GROUPS.map((g) => (
                <div key={g.id}>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-soft">
                    {g.label}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {AWARD_TYPES.filter((t) => t.group === g.id).map((t) => {
                      const checked = awardTypeCodes.includes(t.code);
                      return (
                        <label
                          key={t.code}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-brand-teal-soft/30"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAwardType(t.code)}
                            className="h-4 w-4 rounded border-border accent-brand-vermilion"
                          />
                          <span className="font-mono text-[10px] text-muted-soft w-12 shrink-0">{t.code}</span>
                          <span className="truncate">{t.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="text-[10px] text-muted-soft">
                {awardTypeCodes.length === 0
                  ? 'None selected — view will pull all types.'
                  : `${awardTypeCodes.length} selected.`}
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Place of performance — states</Label>
            <div className="rounded-lg border border-border bg-brand-teal-deep/40 p-3">
              {/* Selected chips */}
              {popStates.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {popStates.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => togglePopState(code)}
                      className="inline-flex items-center gap-1 rounded-md border border-brand-vermilion/30 bg-brand-vermilion/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-vermilion-soft transition-colors hover:bg-brand-vermilion/25"
                      title="Click to remove"
                    >
                      {code} — {stateName(code)}
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPopStates([])}
                    className="rounded-md border border-border bg-brand-teal-deep/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted-soft transition-colors hover:text-foreground"
                  >
                    Clear all
                  </button>
                </div>
              )}
              {/* Search */}
              <Input
                value={stateSearch}
                onChange={(e) => setStateSearch(e.target.value)}
                placeholder="Filter states… (e.g. tex, GA, virgin)"
                className="mb-2"
              />
              {/* Grid */}
              <div className="max-h-[180px] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {filteredStates.map((s) => {
                    const checked = popStates.includes(s.code);
                    return (
                      <label
                        key={s.code}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-brand-teal-soft/30"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePopState(s.code)}
                          className="h-3.5 w-3.5 rounded border-border accent-brand-vermilion"
                        />
                        <span className="font-mono text-[10px] text-muted-soft w-7 shrink-0">{s.code}</span>
                        <span className="truncate">{s.name}</span>
                      </label>
                    );
                  })}
                </div>
                {filteredStates.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-soft">No matches.</div>
                )}
              </div>
              <div className="mt-2 text-[10px] text-muted-soft">
                {popStates.length === 0
                  ? 'None selected — view will pull from all locations.'
                  : `${popStates.length} state${popStates.length === 1 ? '' : 's'} selected.`}
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Award value range (USD)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="Minimum (e.g. 100000)"
                />
                <div className="mt-1 text-[10px] text-muted-soft">Min — leave blank for no floor.</div>
              </div>
              <div>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="Maximum (e.g. 5000000)"
                />
                <div className="mt-1 text-[10px] text-muted-soft">Max — leave blank for no ceiling.</div>
              </div>
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>Contract end date — window</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Select value={lookbackMonths} onChange={(e) => setLookbackMonths(e.target.value)}>
                  {LOOKBACK_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
                <div className="mt-1 text-[10px] text-muted-soft">History — past, e.g. 18 months back.</div>
              </div>
              <div>
                <Select value={forwardMonths} onChange={(e) => setForwardMonths(e.target.value)}>
                  {FORWARD_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
                <div className="mt-1 text-[10px] text-muted-soft">Forward — future, e.g. 6 months ahead.</div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-muted-soft">
              Pulls contracts whose end date is between <span className="font-mono">today − history</span> and <span className="font-mono">today + forward</span>. Set Forward to "No upper bound" to include all still-running contracts regardless of end date.
            </div>
          </div>

          <div className="md:col-span-2 flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-brand-vermilion"
              />
              Enabled
            </label>
            <span className="text-xs text-muted-soft">Disabled views aren't ingested or shown to users.</span>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create view'}
          </Button>
        </div>
      </motion.form>
    </div>
  );
}
