/**
 * Shared types + persistence for the active "view" the user is browsing.
 */

export interface ViewFilters {
  /** Federal toptier agency name (e.g. "Department of Health and Human Services"). */
  toptier_agency_name?: string;
  /** Federal subtier agency name (e.g. "Centers for Disease Control and Prevention"). */
  subtier_agency_name?: string;
  office_names?: string[];
  keywords?: string[];
  naics_codes?: string[];
  psc_codes?: string[];
  award_types?: string[];
  min_value?: number;
  max_value?: number;
  /** US state codes for place-of-performance filter (e.g. ["TX","GA"]). */
  pop_states?: string[];
  /** History side of the contract-end-date window (months). */
  lookback_months?: number;
  /** Forward side of the contract-end-date window (months). 0/blank = no upper bound. */
  forward_months?: number;
}

export interface DataView {
  view_id: string;
  name: string;
  description: string | null;
  enabled?: boolean;
  filters: ViewFilters;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ViewAccess {
  access_id: string;
  status: 'requested' | 'granted' | 'denied' | 'revoked';
  requested_at: string | null;
  decided_at: string | null;
}

export interface ViewLatestRequest {
  request_id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  attempt: number;
  max_attempts: number;
  requested_at: string;
  next_attempt_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

export interface BrowseViewRow extends DataView {
  access: ViewAccess | null;
  /** Number of awards currently tagged into this view (via view_award). */
  award_count?: number;
  /** Admin-only: most recent Run Now request, if any. */
  latest_request?: ViewLatestRequest | null;
}

const ACTIVE_VIEW_KEY = 'awards.active_view_id';

export function getActiveViewId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_VIEW_KEY);
}

export function setActiveViewId(viewId: string | null) {
  if (typeof window === 'undefined') return;
  if (viewId) localStorage.setItem(ACTIVE_VIEW_KEY, viewId);
  else        localStorage.removeItem(ACTIVE_VIEW_KEY);
}
