import { cn } from '@/lib/utils';

/**
 * CaptureRadar brand mark.
 *
 * Composition:
 *  - Rounded-square chip with a vermilion → terracotta gradient (carried over
 *    from the AwardLens identity for visual continuity).
 *  - Concentric radar rings (3 ranges) over a darkened scope face.
 *  - A vermilion sweep wedge from center to ~1 o'clock signaling "scanning."
 *  - A sage signal blip at the wedge edge — the captured target.
 *  - A cream highlight in the upper-left for chip dimensionality.
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
      aria-label="CaptureRadar"
      className={cn(
        'shrink-0',
        withGlow && 'drop-shadow-[0_0_18px_rgba(230,72,51,0.45)]',
        className,
      )}
    >
      <defs>
        <linearGradient id="cr-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#E64833" />
          <stop offset="55%"  stopColor="#D03826" />
          <stop offset="100%" stopColor="#874F41" />
        </linearGradient>
        {/* Sweep wedge — bright at center, fading to transparent at the edge */}
        <radialGradient id="cr-sweep" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FBE9D0" stopOpacity="0.95" />
          <stop offset="60%"  stopColor="#FBE9D0" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#FBE9D0" stopOpacity="0" />
        </radialGradient>
        {/* Scope face — slightly darker than the chip so the rings read */}
        <radialGradient id="cr-scope" cx="50%" cy="50%" r="55%">
          <stop offset="0%"   stopColor="#173039" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0d1f25" stopOpacity="0.85" />
        </radialGradient>
        {/* Signal blip halo */}
        <radialGradient id="cr-blip" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#90AEAD" stopOpacity="1" />
          <stop offset="60%"  stopColor="#90AEAD" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#90AEAD" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Chip background */}
      <rect
        x="0" y="0" width="64" height="64" rx="14"
        fill="url(#cr-bg)"
        opacity={subtle ? 0.85 : 1}
      />

      {/* Subtle inner highlight on the chip */}
      <rect
        x="0" y="0" width="64" height="32" rx="14"
        fill="white" opacity="0.06"
      />

      {/* Scope face */}
      <circle cx="32" cy="32" r="22" fill="url(#cr-scope)" />

      {/* Concentric range rings */}
      <circle cx="32" cy="32" r="22" fill="none" stroke="#FBE9D0" strokeOpacity="0.28" strokeWidth="1.25" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#FBE9D0" strokeOpacity="0.20" strokeWidth="1" />
      <circle cx="32" cy="32" r="8"  fill="none" stroke="#FBE9D0" strokeOpacity="0.16" strokeWidth="1" />

      {/* Crosshairs — horizontal + vertical hairlines */}
      <line x1="10" y1="32" x2="54" y2="32" stroke="#FBE9D0" strokeOpacity="0.10" strokeWidth="0.75" />
      <line x1="32" y1="10" x2="32" y2="54" stroke="#FBE9D0" strokeOpacity="0.10" strokeWidth="0.75" />

      {/* Sweep wedge — center-anchored, ~30° arc to 1 o'clock */}
      {/* Path: start at center, arc out along the ring at 0° (12 o'clock), close at center */}
      <path
        d="M 32 32 L 32 10 A 22 22 0 0 1 50.5 21 Z"
        fill="url(#cr-sweep)"
        opacity={subtle ? 0.55 : 0.85}
      />

      {/* Sweep leading edge — crisp vermilion line from center to ring edge */}
      <line x1="32" y1="32" x2="50.5" y2="21"
        stroke="#FBE9D0" strokeOpacity="0.85" strokeWidth="1.25"
        strokeLinecap="round"
      />

      {/* Center pin */}
      <circle cx="32" cy="32" r="2.5" fill="#FBE9D0" fillOpacity="0.92" />
      <circle cx="32" cy="32" r="1"   fill="#0d1f25" />

      {/* Signal blip — sage halo + bright dot, sitting on the outer ring at 2 o'clock */}
      <circle cx="48" cy="22" r="5.5" fill="url(#cr-blip)" />
      <circle cx="48" cy="22" r="2.2" fill="#FBE9D0" />
    </svg>
  );
}

/**
 * Word-mark used next to the chip mark in headers.
 * "Capture" in foreground; "Radar" in vermilion gradient as the accent.
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
        Capture<span className="bg-gradient-to-r from-brand-vermilion to-brand-vermilion-soft bg-clip-text text-transparent">Radar</span>
      </span>
    </div>
  );
}
