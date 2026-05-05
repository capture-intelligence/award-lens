import { cn } from '@/lib/utils';

/**
 * SkeletonLoader (#11 in spec shared components) — shimmer loading state
 * mirroring the real component structure. Variants:
 *   - 'text'    short text line
 *   - 'title'   larger heading
 *   - 'row'     full table row width
 *   - 'card'    card-shaped block
 *   - 'circle'  avatar/icon
 */
export function Skeleton({
  variant = 'text',
  className,
  width,
  height,
}: {
  variant?: 'text' | 'title' | 'row' | 'card' | 'circle';
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  const base = 'shimmer rounded';
  const sizing =
    variant === 'text'   ? 'h-3 w-24' :
    variant === 'title'  ? 'h-5 w-48' :
    variant === 'row'    ? 'h-8 w-full' :
    variant === 'card'   ? 'h-32 w-full' :
    /* circle */           'h-9 w-9 rounded-full';
  return (
    <div
      className={cn(base, sizing, className)}
      style={{
        width:  width  ?? undefined,
        height: height ?? undefined,
      }}
      aria-busy="true"
      aria-live="polite"
    />
  );
}

/** TableSkeleton — n rows of equally-sized cells, matches DataTable layout. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-2 p-2" role="status" aria-label="Loading rows">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} variant="row" className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/* The shimmer keyframes are defined in index.css (.shimmer). */
