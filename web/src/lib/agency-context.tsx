/**
 * Top-of-screen awarding-agency selector — replaces the legacy "All views
 * (admin)" dropdown. Default scope is CDC; admins can switch to NIH, CMS,
 * FDA, etc. The choice is persisted to localStorage so a refresh keeps
 * the user where they were.
 *
 * Filters (per-user access) still exist underneath for power use; the
 * agency picker is the primary scope every page reads from.
 */

import * as React from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';

const STORAGE_KEY        = 'awardlens.awarding_agency';
const CENTER_STORAGE_KEY = 'awardlens.center_code';
const DEFAULT_AGENCY     = 'Centers for Disease Control and Prevention';

// Default filter window every time the scope (agency/center) resets.
// Keeps the dashboard pointed at "active opportunities right now" rather
// than the entire historical universe. Users can clear or widen.
const DEFAULT_MIN_VALUE        = '4000000';
const DEFAULT_LOOKBACK_DAYS    = 60;   // contract ended up to 60 days ago
const DEFAULT_FORWARD_DAYS     = 180;  // contract ends within next 180 days

function todayEpochDay(): number {
  return Math.floor(Date.now() / 86400000);
}
function defaultDateRange(): [number, number] {
  const today = todayEpochDay();
  return [today - DEFAULT_LOOKBACK_DAYS, today + DEFAULT_FORWARD_DAYS];
}

export interface AwardingAgency {
  name: string;          // canonical_name in the organization table
  toptier: string | null;
  n: number;
}

export interface CenterOption {
  code: string;          // e.g., "NCHHSTP"
  name: string;          // e.g., "National Center for HIV..."
  n: number;
}

interface AgencyContextValue {
  /** Distinct awarding agencies present in the warehouse, ranked by award count. */
  agencies: AwardingAgency[];
  /** The currently selected agency name (null = no scope, admin only). */
  active: string | null;
  loading: boolean;
  error: string | null;
  setActive: (name: string | null) => void;
  refresh: () => Promise<void>;
  /** Centers that exist for the current agency, ranked by award count. */
  centers: CenterOption[];
  /** Center filter — null = show all centers within the agency. */
  activeCenter: string | null;
  centersLoading: boolean;
  setActiveCenter: (code: string | null) => void;

  /**
   * Top-of-screen value filter (current_value $ range).
   * Either bound is optional; null/empty means "no constraint".
   * State lives here so the filter applies uniformly to Pivot / Summary / Tree.
   */
  minValue: string;
  maxValue: string;
  setMinValue: (v: string) => void;
  setMaxValue: (v: string) => void;

  /**
   * Top-of-screen date filter (pop_end_date range as epoch-day pair).
   * null = no filter. dateBounds carries the data's natural extent so the
   * slider knows where to anchor.
   */
  dateRange: [number, number] | null;
  setDateRange: (r: [number, number] | null) => void;
  dateBounds: { min: number; max: number } | null;
  setDateBounds: (b: { min: number; max: number } | null) => void;

  /**
   * Top-of-screen Nature-of-work filter — empty Set = "All".
   * State lives here so the picker in the topbar drives every tab
   * (Tree / Summary / Pivot) consistently.
   */
  selectedNatures: Set<string>;
  setSelectedNatures: (s: Set<string>) => void;
}

const AgencyContext = React.createContext<AgencyContextValue | undefined>(undefined);

function readStored(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}
function writeStored(v: string | null) {
  if (typeof window === 'undefined') return;
  if (v) localStorage.setItem(STORAGE_KEY, v);
  else   localStorage.removeItem(STORAGE_KEY);
}

function readStoredCenter(agency: string | null): string | null {
  if (!agency || typeof window === 'undefined') return null;
  // Center is keyed per agency — switching agency shouldn't reuse the
  // previous center automatically (NCHHSTP doesn't make sense for NIH).
  return localStorage.getItem(`${CENTER_STORAGE_KEY}.${agency}`);
}
function writeStoredCenter(agency: string | null, v: string | null) {
  if (!agency || typeof window === 'undefined') return;
  const key = `${CENTER_STORAGE_KEY}.${agency}`;
  if (v) localStorage.setItem(key, v);
  else   localStorage.removeItem(key);
}

export function AgencyProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const [agencies, setAgencies] = React.useState<AwardingAgency[]>([]);
  const [active, setActiveState] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (status !== 'approved') {
      setAgencies([]);
      setLoading(false);
      return;
    }
    try {
      const r = await api.get<{ results: AwardingAgency[] }>('/awarding-agencies');
      const rows = r.results ?? [];
      setAgencies(rows);

      // Resolve the "active" agency from localStorage if it still exists in
      // the catalog; otherwise fall back to CDC default if present.
      const stored = readStored();
      const found = stored && rows.find((a) => a.name === stored);
      if (found) {
        setActiveState(found.name);
      } else {
        const cdc = rows.find((a) => a.name === DEFAULT_AGENCY);
        if (cdc) {
          setActiveState(cdc.name);
          writeStored(cdc.name);
        } else if (rows.length > 0) {
          // No CDC in the catalog (unusual) — pick the largest agency.
          setActiveState(rows[0]!.name);
          writeStored(rows[0]!.name);
        } else {
          setActiveState(null);
          writeStored(null);
        }
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load agencies');
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  // ─── Center catalog (per active agency) ───
  const [centers,        setCenters]        = React.useState<CenterOption[]>([]);
  const [centersLoading, setCentersLoading] = React.useState(false);
  const [activeCenter,   setActiveCenterState] = React.useState<string | null>(null);

  // Whenever the active agency changes, refresh the center catalog and
  // resolve the saved-center selection (per-agency localStorage key).
  React.useEffect(() => {
    if (!active || status !== 'approved') {
      setCenters([]);
      setActiveCenterState(null);
      return;
    }
    let alive = true;
    setCentersLoading(true);
    (async () => {
      try {
        const r = await api.get<{ results: CenterOption[] }>(
          '/centers',
          { awarding_agency: active },
        );
        if (!alive) return;
        const rows = r.results ?? [];
        setCenters(rows);
        const stored = readStoredCenter(active);
        const found = stored && rows.find((c) => c.code === stored);
        setActiveCenterState(found ? found.code : null);
      } catch {
        if (alive) {
          setCenters([]);
          setActiveCenterState(null);
        }
      } finally {
        if (alive) setCentersLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [active, status]);

  const setActive = React.useCallback(
    (name: string | null) => {
      setActiveState(name);
      writeStored(name);
      // Don't clobber the new agency's stored center; the effect above
      // will resolve it on the next render.
    },
    [],
  );

  const setActiveCenter = React.useCallback(
    (code: string | null) => {
      setActiveCenterState(code);
      writeStoredCenter(active, code);
    },
    [active],
  );

  // Suppress the unused-variable warning — `user` is intentionally tracked
  // via useAuth for future role-based agency restrictions.
  void user;

  // ─── Top-of-screen value & date filters ───
  // Default to a "current opportunities" window: ≥$4M and contracts ending
  // in [today − 60d, today + 180d]. User can clear or widen at any time;
  // changing the scope (agency/center) re-applies these defaults.
  const [minValue, setMinValue] = React.useState(DEFAULT_MIN_VALUE);
  const [maxValue, setMaxValue] = React.useState('');
  const [dateRange, setDateRange]   = React.useState<[number, number] | null>(defaultDateRange());
  const [dateBounds, setDateBounds] = React.useState<{ min: number; max: number } | null>(null);
  const [selectedNatures, setSelectedNatures] = React.useState<Set<string>>(new Set());

  // Re-apply defaults whenever the scope changes (different agency or
  // center starts fresh — keeps the "active opportunities" lens consistent).
  React.useEffect(() => {
    setMinValue(DEFAULT_MIN_VALUE);
    setMaxValue('');
    setDateRange(defaultDateRange());
    setDateBounds(null);
    setSelectedNatures(new Set());
  }, [active, activeCenter]);

  const value: AgencyContextValue = {
    agencies, active, loading, error, setActive, refresh,
    centers, activeCenter, centersLoading, setActiveCenter,
    minValue, maxValue, setMinValue, setMaxValue,
    dateRange, setDateRange, dateBounds, setDateBounds,
    selectedNatures, setSelectedNatures,
  };

  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>;
}

export function useAgency(): AgencyContextValue {
  const v = React.useContext(AgencyContext);
  if (!v) throw new Error('useAgency must be used inside <AgencyProvider>');
  return v;
}

/** Epoch-day helpers for the date slider — exported so consumers stay consistent. */
export function dateToEpochDay(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 86400000);
}
export function epochDayToDate(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10);
}

/**
 * Companion to useViewQuery — returns the awarding-agency + optional center
 * query fragment for /explore and other data endpoints. Empty object when
 * neither is set (admin "All data" mode).
 */
export function useAgencyQuery(): { awarding_agency?: string; center_code?: string } | undefined {
  const { active, activeCenter } = useAgency();
  if (!active && !activeCenter) return undefined;
  const q: { awarding_agency?: string; center_code?: string } = {};
  if (active) q.awarding_agency = active;
  if (activeCenter) q.center_code = activeCenter;
  return q;
}
