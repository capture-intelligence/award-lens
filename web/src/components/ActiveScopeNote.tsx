import { useAgency } from '@/lib/agency-context';
import { fmtMoney } from '@/lib/utils';

type Dim = 'agency' | 'center' | 'value' | 'date' | 'nature';

/**
 * Compact, muted summary of the top-bar scope currently narrowing a list, so
 * it's obvious the picker is driving the content. `dims` limits which filters
 * are shown to the ones a given page actually applies (e.g. Awardees only
 * scopes by agency). Renders nothing when no shown filter is active.
 */
export function ActiveScopeNote({ dims }: { dims?: Dim[] }) {
  const { active, activeCenter, minValue, maxValue, dateRange, selectedNatures } = useAgency();
  const show = new Set<Dim>(dims ?? ['agency', 'center', 'value', 'date', 'nature']);
  const parts: string[] = [];

  if (show.has('agency') && active) parts.push(active);
  if (show.has('center') && activeCenter) parts.push(activeCenter);
  if (show.has('value')) {
    const hasMin = minValue.trim() !== '' && Number(minValue) > 0;
    const hasMax = maxValue.trim() !== '' && Number(maxValue) > 0;
    if (hasMin && hasMax) parts.push(`${fmtMoney(Number(minValue))}–${fmtMoney(Number(maxValue))}`);
    else if (hasMin) parts.push(`≥ ${fmtMoney(Number(minValue))}`);
    else if (hasMax) parts.push(`≤ ${fmtMoney(Number(maxValue))}`);
  }
  if (show.has('date') && dateRange) parts.push('date window');
  if (show.has('nature') && selectedNatures.size > 0) parts.push([...selectedNatures].join(', '));

  if (parts.length === 0) return null;
  return (
    <span className="text-[11px] text-muted-soft">
      Scoped to <span className="text-muted">{parts.join(' · ')}</span>
    </span>
  );
}
