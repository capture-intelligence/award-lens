import { cn } from '@/lib/utils';

/**
 * AwardLens AI brand mark.
 *
 * Composition:
 *  - Rounded-square chip with a vermilion → terracotta gradient.
 *  - Concentric lens body (outer ring + iris + dark pupil + cream catchlight)
 *    that reads as a camera lens / eye — the "Lens" in AwardLens.
 *  - A glowing sage spark in the upper-right — the "AI" sense of insight.
 *
 * Renders crisp at any size. Use `size` to set the box edge in px,
 * `withGlow` to add an ambient drop-shadow halo, and `subtle` for a
 * lower-contrast variant.
 */
export interface LogoProps {
  className?: string;
  size?: number;
  withGlow?: boolean;
  /** Lower-contrast variant — used inside text contexts where the chip should recede. */
  subtle?: boolean;
}

export function Logo({ className, size = 36, withGlow = false, subtle = false }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      role="img"
      aria-label="AwardLens AI"
      className={cn(
        'shrink-0',
        withGlow && 'drop-shadow-[0_0_18px_rgba(230,72,51,0.45)]',
        className,
      )}
    >
      <defs>
        <linearGradient id="al-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#E64833" />
          <stop offset="55%"  stopColor="#D03826" />
          <stop offset="100%" stopColor="#874F41" />
        </linearGradient>
        <radialGradient id="al-spark" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#90AEAD" stopOpacity="1" />
          <stop offset="55%"  stopColor="#FBE9D0" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FBE9D0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="al-pupil" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#0d1f25" />
          <stop offset="100%" stopColor="#173039" />
        </radialGradient>
      </defs>

      {/* Chip background */}
      <rect
        x="0" y="0" width="64" height="64" rx="14"
        fill="url(#al-bg)"
        opacity={subtle ? 0.85 : 1}
      />

      {/* Subtle inner highlight on the chip */}
      <rect
        x="0" y="0" width="64" height="32" rx="14"
        fill="white" opacity="0.06"
      />

      {/* Outer lens halo */}
      <circle cx="32" cy="32" r="20" fill="none" stroke="#FBE9D0" strokeOpacity="0.22" strokeWidth="1.5" />

      {/* Iris */}
      <circle cx="32" cy="32" r="13.5" fill="url(#al-pupil)" stroke="#FBE9D0" strokeOpacity="0.85" strokeWidth="1.5" />

      {/* Pupil */}
      <circle cx="32" cy="32" r="6" fill="#0d1f25" />

      {/* Catchlight (cream eye highlight) */}
      <circle cx="29" cy="29" r="2" fill="#FBE9D0" fillOpacity="0.95" />

      {/* AI spark — soft halo */}
      <circle cx="47" cy="17" r="9" fill="url(#al-spark)" />
      {/* AI spark — bright dot */}
      <circle cx="47" cy="17" r="2.4" fill="#FBE9D0" />
    </svg>
  );
}

/**
 * Word-mark used next to the chip mark in headers.
 * Keeps the typography crisp and consistent across surfaces.
 */
export function Wordmark({
  size = 'md',
  tagline,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  /** Optional one-liner shown above the brand name in muted text. */
  tagline?: string;
  className?: string;
}) {
  const nameClass =
    size === 'lg' ? 'text-xl font-black tracking-tight' :
    size === 'sm' ? 'text-[13px] font-bold tracking-tight' :
                    'text-base font-bold tracking-tight';
  const taglineClass =
    size === 'lg' ? 'text-[11px] tracking-[0.22em]' :
                    'text-[10px] tracking-[0.18em]';
  return (
    <div className={cn('flex flex-col leading-tight', className)}>
      {tagline && (
        <span className={cn('font-semibold uppercase text-muted-soft', taglineClass)}>
          {tagline}
        </span>
      )}
      <span className={cn('text-foreground', nameClass)}>
        AwardLens <span className="bg-gradient-to-r from-brand-vermilion to-brand-vermilion-soft bg-clip-text text-transparent">AI</span>
      </span>
    </div>
  );
}
