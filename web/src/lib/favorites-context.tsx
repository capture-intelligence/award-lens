import * as React from 'react';
import { api } from '@/lib/api';

/**
 * Favorites — a session-wide cache of the signed-in user's favorited entities,
 * so FavoriteStar buttons don't each fetch. Loads once from GET /me/favorites;
 * toggle() updates optimistically and POSTs/DELETEs, reverting on failure.
 * Mounted inside the authed app tree (only approved users).
 */

export interface Favorite { entity_type: string; entity_id: string; created_at: string }

interface FavCtx {
  list: Favorite[];
  loading: boolean;
  isFav: (type: string, id: string) => boolean;
  toggle: (type: string, id: string) => void;
}

const Ctx = React.createContext<FavCtx | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = React.useState<Favorite[]>([]);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(() => {
    return api.get<{ results: Favorite[] }>('/me/favorites')
      .then((d) => setList(d.results ?? []))
      .catch(() => { /* keep current */ });
  }, []);

  React.useEffect(() => {
    let alive = true;
    api.get<{ results: Favorite[] }>('/me/favorites')
      .then((d) => { if (alive) setList(d.results ?? []); })
      .catch(() => { if (alive) setList([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = React.useMemo(() => new Set(list.map((f) => `${f.entity_type}:${f.entity_id}`)), [list]);
  const isFav = React.useCallback((type: string, id: string) => set.has(`${type}:${id}`), [set]);

  const toggle = React.useCallback((type: string, id: string) => {
    const currently = set.has(`${type}:${id}`);
    // Optimistic update.
    setList((prev) => currently
      ? prev.filter((f) => !(f.entity_type === type && f.entity_id === id))
      : [{ entity_type: type, entity_id: id, created_at: new Date().toISOString() }, ...prev]);
    const req = currently
      ? api.del(`/me/favorites/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
      : api.post('/me/favorites', { entity_type: type, entity_id: id });
    Promise.resolve(req).catch(() => { reload(); }); // on failure, resync from server
  }, [set, reload]);

  return <Ctx.Provider value={{ list, loading, isFav, toggle }}>{children}</Ctx.Provider>;
}

export function useFavorites() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useFavorites must be used within FavoritesProvider');
  return c;
}
