/**
 * Earthy nature-of-work palette — single source of truth for every
 * visualization that colors awards by their derived NATURE_BUCKETS
 * label. Each bucket sits in its own hue family (plum, moss, slate,
 * rust, ochre, sage, umber, stone) so adjacent groups read as visually
 * distinct against the dark teal canvas (#0d1f25). Saturation is held
 * down across the set so no single bucket dominates the eye.
 *
 * Used by Clusters (AwardBubbleTab) and Timeline (AwardTimelineTab);
 * any new viz that surfaces nature-of-work coloring should import
 * from here rather than duplicating values.
 */

import type { NatureBucket } from './nature-of-work';

export const NATURE_COLORS: Record<NatureBucket, string> = {
  'Research / R&D':              '#7B5B6B', // deep plum
  'Data / Surveillance Systems': '#7A8B4D', // moss / olive
  'IT / Software':               '#2F4A78', // deep saturated indigo-blue
  'Communications / Outreach':   '#B5503D', // rust
  'Evaluation / Assessment':     '#C5973A', // mustard ochre
  'Program Support / PMO':       '#90AEAD', // brand sage
  'Goods / Equipment':           '#8E6943', // burnt umber
  'Other / Mixed':               '#857B70', // stone gray
};

export const NATURE_FALLBACK = '#857B70';

export function colorForNature(name: string): string {
  return (NATURE_COLORS as Record<string, string>)[name] ?? NATURE_FALLBACK;
}
