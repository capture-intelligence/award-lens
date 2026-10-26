import * as React from 'react';
import { Compass } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAgencyQuery, useAgency, dateToEpochDay } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth-context';
import { useSetSelectedAward } from '@/lib/ai-award-context';
import { natureOfWork } from '@/lib/nature-of-work';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { NoViewSelected } from '@/components/ui/NoViewSelected';
import { EmptyState } from '@/components/ui/EmptyState';
import { AwardBrowser } from '@/pages/Analytics';

/**
 * Explore — a raw, searchable, sortable table of the awards in scope, over the
 * same /explore data that powers the Award Analytics charts. It reuses the
 * AwardBrowser (the Analytics "Summary" view) on its own page, so you can
 * browse the underlying rows without the chart tabs. Scope + value/date/nature
 * filters come from the top agency picker (shared context); search and sort
 * are local to the table. Clicking a row opens the global award detail panel.
 */

interface ExploreResponse {
  view_id: string;
  view_name: string;
  count: number;
  results: Record<string, unknown>[];
}

export function ExplorePage() {
  const agencyQuery = useAgencyQuery();
  const { loading: agencyLoading, minValue, maxValue, dateRange, dateField, selectedNatures } = useAgency();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const setSelectedAward = useSetSelectedAward();

  const [data, setData] = React.useState<ExploreResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Mirror Analytics: wait for the agency picker to settle; admins may browse
  // the full warehouse with no agency selected.
  const canQuery = !agencyLoading && (!!agencyQuery || isAdmin);

  React.useEffect(() => {
    if (!canQuery) return;
    let alive = true;
    setData(null); setError(null);
    (async () => {
      try {
        const r = await api.get<ExploreResponse>('/explore', agencyQuery);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [canQuery, agencyQuery?.awarding_agency, agencyQuery?.center_code]);

  // Apply the topbar value/date/nature filters (same logic as Analytics) so the
  // picker narrows this table too; AwardBrowser handles search + sort locally.
  const filteredRows = React.useMemo<Record<string, unknown>[]>(() => {
    if (!data?.results) return [];
    const minNum = minValue.trim() === '' ? null : Number(minValue);
    const maxNum = maxValue.trim() === '' ? null : Number(maxValue);
    const hasMin = minNum != null && Number.isFinite(minNum);
    const hasMax = maxNum != null && Number.isFinite(maxNum);
    const hasDate = dateRange != null;
    const hasNature = selectedNatures.size > 0;
    if (!hasMin && !hasMax && !hasDate && !hasNature) return data.results;
    return data.results.filter((r) => {
      if (hasMin || hasMax) {
        const value = Number(r.current_value ?? 0);
        if (hasMin && value < (minNum as number)) return false;
        if (hasMax && value > (maxNum as number)) return false;
      }
      if (hasDate) {
        const col = dateField === 'start' ? 'pop_start_date' : 'pop_end_date';
        const d = dateToEpochDay(r[col] as string | undefined);
        if (d != null && (d < dateRange![0] || d > dateRange![1])) return false;
      }
      if (hasNature && !selectedNatures.has(natureOfWork(r as any))) return false;
      return true;
    });
  }, [data, minValue, maxValue, dateRange, dateField, selectedNatures]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Explore"
        title="Explore Awards"
        description="Browse the raw awards in scope — search, sort, and open any award. Scope and value / date / nature filters come from the picker up top."
      />
      {!canQuery ? (
        <NoViewSelected pageLabel="explore awards" />
      ) : error ? (
        <Card><div className="p-8"><EmptyState icon={Compass} title="Couldn't load awards." message={error} /></div></Card>
      ) : !data ? (
        <Card><TableSkeleton rows={10} /></Card>
      ) : (
        <div className="awardlens-tab-fill flex flex-col h-[calc(100dvh-210px)]">
          <AwardBrowser rows={filteredRows} onSelect={setSelectedAward} viewName={data.view_name} />
        </div>
      )}
    </div>
  );
}
