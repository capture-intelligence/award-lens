import * as React from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth-context';
import {
  type DataView, type BrowseViewRow,
  getActiveViewId, setActiveViewId,
} from './views';

interface ViewContextValue {
  /** All views the user can choose from (granted-access for users; all enabled for admins). */
  available: DataView[];
  /** Full browse list, including pending/denied — admin sees nothing extra here. */
  browse: BrowseViewRow[];
  /** Currently selected view (or null if admin viewing unscoped, or no views). */
  active: DataView | null;
  /** True while the initial fetch is in flight. */
  loading: boolean;
  error: string | null;
  /** Pick a view from `available` (or null to clear, admin only). */
  setActive: (viewId: string | null) => void;
  /** Re-fetch the views list (after creating, requesting access, etc.). */
  refresh: () => Promise<void>;
}

const ViewContext = React.createContext<ViewContextValue | undefined>(undefined);

export function ViewProvider({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const [browse, setBrowse]   = React.useState<BrowseViewRow[]>([]);
  const [active, setActiveState] = React.useState<DataView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const refresh = React.useCallback(async () => {
    if (status !== 'approved') {
      setBrowse([]);
      setActiveState(null);
      setLoading(false);
      return;
    }
    try {
      // Reads from /filters (data_view façade). The response carries
      // filter_id; we alias to view_id locally so existing component code
      // keeps working until the rename lands.
      const r = await api.get<{ results: Array<BrowseViewRow & { filter_id?: string }> }>('/filters');
      const rows = (r.results ?? []).map((row) => ({
        ...row,
        view_id: row.filter_id ?? row.view_id,
      })) as BrowseViewRow[];
      setBrowse(rows);

      // Resolve the "active" view from localStorage if still accessible.
      const stored = getActiveViewId();
      const granted = rows.filter((row) => isAdmin || row.access?.status === 'granted');
      const found = stored ? granted.find((g) => g.view_id === stored) : undefined;
      if (found) {
        setActiveState(found);
      } else if (granted.length === 1) {
        setActiveState(granted[0]!);
        setActiveViewId(granted[0]!.view_id);
      } else if (granted.length === 0) {
        setActiveState(null);
        setActiveViewId(null);
      } else {
        // Multiple granted, none stored — leave as null; user picks from selector.
        setActiveState(null);
        setActiveViewId(null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load views');
    } finally {
      setLoading(false);
    }
  }, [status, isAdmin]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActive = React.useCallback(
    (viewId: string | null) => {
      if (!viewId) {
        setActiveViewId(null);
        setActiveState(null);
        return;
      }
      const found = browse.find((b) => b.view_id === viewId);
      if (!found) return;
      // Block selecting a non-granted view (defensive — UI should hide too).
      if (!isAdmin && found.access?.status !== 'granted') return;
      setActiveViewId(viewId);
      setActiveState(found);
    },
    [browse, isAdmin],
  );

  const available = React.useMemo(
    () => browse.filter((b) => isAdmin || b.access?.status === 'granted'),
    [browse, isAdmin],
  );

  const value: ViewContextValue = {
    available, browse, active, loading, error,
    setActive, refresh,
  };

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>;
}

export function useViews(): ViewContextValue {
  const v = React.useContext(ViewContext);
  if (!v) throw new Error('useViews must be used inside <ViewProvider>');
  return v;
}

/**
 * For data fetches: returns the query-string fragment to scope by the active
 * filter. Sends `filter_id` (the new path) — the worker still accepts the
 * legacy `view_id` form too, so older callers don't break.
 */
export function useViewQuery(): { filter_id: string } | undefined {
  const { active } = useViews();
  return active ? { filter_id: active.view_id } : undefined;
}
