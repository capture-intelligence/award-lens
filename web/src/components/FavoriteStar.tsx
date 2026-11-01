import { Star } from 'lucide-react';
import { useFavorites } from '@/lib/favorites-context';

/**
 * Toggle an entity's favorite state. Reads/writes the FavoritesProvider cache,
 * so it reflects and updates the shared set without its own fetch.
 */
export function FavoriteStar({ entity_type, entity_id, label = 'Favorite' }: { entity_type: string; entity_id: string; label?: string }) {
  const { isFav, toggle } = useFavorites();
  const fav = isFav(entity_type, entity_id);
  return (
    <button
      type="button"
      onClick={() => toggle(entity_type, entity_id)}
      aria-pressed={fav}
      title={fav ? 'Remove from favorites' : 'Add to favorites'}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
    >
      <Star className={`h-3.5 w-3.5 ${fav ? 'fill-brand-vermilion text-brand-vermilion' : ''}`} />
      <span className="hidden md:inline">{fav ? 'Favorited' : label}</span>
    </button>
  );
}
