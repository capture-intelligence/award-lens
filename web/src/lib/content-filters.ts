/**
 * Shared adapters that turn the top-bar picker state (agency / center / value /
 * date / nature, held in AgencyContext) into the right shape for each content
 * list page:
 *   - server query params where the endpoint filters server-side (agency +
 *     center scope, value band), and
 *   - client-side row predicates where the signal can't be expressed in SQL
 *     (Nature is a PSC/NAICS/description heuristic) or the list is small enough
 *     to refine in memory (date windows) — the same split the Explore page uses.
 *
 * Every endpoint honors `awarding_agency` (and `/awards` also center/value), so
 * the picker up top finally drives the browseable lists, not just Analytics.
 */
import * as React from 'react';
import { useAgency, dateToEpochDay } from './agency-context';
import { natureOfWork } from './nature-of-work';

/** `/awards` server params: agency + center scope and the value band. */
export function useAwardListParams(): Record<string, string> {
  const { active, activeCenter, minValue, maxValue } = useAgency();
  return React.useMemo(() => {
    const p: Record<string, string> = {};
    if (active) p.awarding_agency = active;
    if (activeCenter) p.center_code = activeCenter;
    const min = Number(minValue);
    if (minValue.trim() !== '' && Number.isFinite(min) && min > 0) p.min_value = String(min);
    const max = Number(maxValue);
    if (maxValue.trim() !== '' && Number.isFinite(max) && max > 0) p.max_value = String(max);
    return p;
  }, [active, activeCenter, minValue, maxValue]);
}

/** Agency-only server param for the lists that scope by agency name. */
export function useAgencyParam(): Record<string, string> {
  const { active } = useAgency();
  return React.useMemo(() => {
    const p: Record<string, string> = {};
    if (active) p.awarding_agency = active;
    return p;
  }, [active]);
}

/**
 * Client-side refinement for award rows: date window + Nature bucket, applied
 * over the agency/center/value-scoped rows the server already returned. Nature
 * is a heuristic (PSC/NAICS/description) that can't live in SQL; the date
 * window mirrors Explore. Returns true = keep.
 */
export function useAwardRowPredicate(): (row: Record<string, unknown>) => boolean {
  const { dateRange, dateField, selectedNatures } = useAgency();
  return React.useMemo(() => {
    const hasDate = dateRange != null;
    const hasNature = selectedNatures.size > 0;
    return (r: Record<string, unknown>) => {
      if (hasDate) {
        const col = dateField === 'start' ? 'pop_start_date' : 'pop_end_date';
        const d = dateToEpochDay(r[col] as string | undefined);
        if (d != null && (d < dateRange![0] || d > dateRange![1])) return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (hasNature && !selectedNatures.has(natureOfWork(r as any))) return false;
      return true;
    };
  }, [dateRange, dateField, selectedNatures]);
}

/**
 * Client-side refinement for grant rows: the top-bar value band maps to
 * est_total_funding and the date window to close_date (the grant-world
 * equivalents of current_value / pop_end). Grants with no stated funding are
 * dropped only when a minimum is set. Returns true = keep.
 */
export function useGrantRowPredicate(): (row: {
  est_total_funding: number | null;
  close_date: string | null;
}) => boolean {
  const { minValue, maxValue, dateRange } = useAgency();
  return React.useMemo(() => {
    const min = minValue.trim() === '' ? null : Number(minValue);
    const max = maxValue.trim() === '' ? null : Number(maxValue);
    const hasMin = min != null && Number.isFinite(min) && min > 0;
    const hasMax = max != null && Number.isFinite(max) && max > 0;
    const hasDate = dateRange != null;
    return (r: { est_total_funding: number | null; close_date: string | null }) => {
      if (hasMin || hasMax) {
        const v = r.est_total_funding;
        if (v == null) {
          if (hasMin) return false;
        } else {
          if (hasMin && v < (min as number)) return false;
          if (hasMax && v > (max as number)) return false;
        }
      }
      if (hasDate) {
        const d = dateToEpochDay(r.close_date);
        if (d != null && (d < dateRange![0] || d > dateRange![1])) return false;
      }
      return true;
    };
  }, [minValue, maxValue, dateRange]);
}
