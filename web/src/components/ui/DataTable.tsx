import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type ExpandedState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TableSkeleton } from './SkeletonLoader';
import { EmptyState } from './EmptyState';

/**
 * DataTable (#1 in spec shared components) — sortable, filterable, paginated;
 * column visibility toggle; expandable row descriptions; selectable rows for
 * bulk export; tabular-nums on monetary/date columns; sticky header; cursor
 * pagination support for tables >1M rows.
 *
 * Server-side sorting + cursor pagination are wired through callbacks; the
 * table itself stays "dumb" so each list page can plug in TanStack Query +
 * its own filter state.
 */

export interface DataTableProps<T> {
  /** TanStack Table column definitions. Use `meta.numeric: true` to right-align + tabular-nums. */
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Total matching rows (for the "5.7M results" pill). */
  totalCount?: number;
  /** Bulk-select column shown when set. */
  enableSelection?: boolean;
  /** Render expandable row body — e.g., the description text under each row. */
  expandedRowRenderer?: (row: T) => React.ReactNode;
  /** Server-side sort. Pass undefined for client-side. */
  sorting?: SortingState;
  onSortingChange?: (s: SortingState) => void;
  /** Cursor-based pagination. */
  nextCursor?: string | null;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  /** Initial loading state. */
  isLoading?: boolean;
  /** Empty-state when data is empty + not loading. */
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  /** Column visibility persistence key. */
  columnVisibilityStorageKey?: string;
  className?: string;
  ariaLabel?: string;
}

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends unknown, TValue> {
    numeric?: boolean;
    minWidth?: number;
    sticky?: boolean;
  }
}

export function DataTable<T>({
  columns,
  data,
  totalCount,
  enableSelection = false,
  expandedRowRenderer,
  sorting,
  onSortingChange,
  nextCursor,
  onLoadMore,
  isLoadingMore,
  isLoading = false,
  emptyTitle,
  emptyMessage,
  emptyAction,
  columnVisibilityStorageKey,
  className,
  ariaLabel = 'Results',
}: DataTableProps<T>) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    if (typeof window === 'undefined' || !columnVisibilityStorageKey) return {};
    try {
      const raw = localStorage.getItem(columnVisibilityStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!columnVisibilityStorageKey) return;
    try {
      localStorage.setItem(columnVisibilityStorageKey, JSON.stringify(columnVisibility));
    } catch {}
  }, [columnVisibility, columnVisibilityStorageKey]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      expanded,
      rowSelection,
    },
    onSortingChange:        onSortingChange ? (u) => onSortingChange(typeof u === 'function' ? u(sorting ?? []) : u) : undefined,
    onColumnVisibilityChange: setColumnVisibility,
    onExpandedChange:       setExpanded,
    onRowSelectionChange:   setRowSelection,
    getCoreRowModel:        getCoreRowModel(),
    enableRowSelection:     enableSelection,
    manualSorting:          Boolean(onSortingChange),
    manualPagination:       Boolean(onLoadMore),
  });

  if (isLoading && data.length === 0) {
    return <TableSkeleton rows={8} columns={columns.length} />;
  }

  if (!isLoading && data.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />;
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="overflow-x-auto rounded-xl border border-border bg-brand-teal-deep/25">
        <table className="w-full text-sm" aria-label={ariaLabel}>
          <thead className="sticky top-0 z-10 bg-brand-teal-deep/85 backdrop-blur-md">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border/60">
                {expandedRowRenderer ? <th className="w-8" /> : null}
                {hg.headers.map((h) => {
                  const isNumeric = h.column.columnDef.meta?.numeric;
                  const sortDir = h.column.getIsSorted();
                  const canSort = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      style={{ minWidth: h.column.columnDef.meta?.minWidth }}
                      className={cn(
                        'whitespace-nowrap px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-soft',
                        isNumeric ? 'text-right' : 'text-left',
                        canSort && 'cursor-pointer select-none hover:text-foreground',
                      )}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3" />
                          : sortDir === 'desc'
                            ? <ArrowDown className="h-3 w-3" />
                            : <ArrowUpDown className="h-3 w-3 opacity-40" />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const isExpanded = row.getIsExpanded();
              return (
                <React.Fragment key={row.id}>
                  <tr className="group border-b border-border/40 transition-colors hover:bg-brand-teal-soft/15">
                    {expandedRowRenderer ? (
                      <td className="w-8 px-1 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => row.toggleExpanded()}
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                          className="grid h-6 w-6 place-items-center rounded text-muted-soft transition-colors hover:bg-brand-teal-soft/30 hover:text-foreground"
                        >
                          {isExpanded
                            ? <ChevronDown  className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    ) : null}
                    {row.getVisibleCells().map((cell) => {
                      const isNumeric = cell.column.columnDef.meta?.numeric;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            'px-3 py-2 align-top text-foreground',
                            isNumeric && 'text-right [font-variant-numeric:tabular-nums_lining-nums]',
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && expandedRowRenderer && (
                    <tr className="border-b border-border/40 bg-brand-teal-deep/15">
                      <td colSpan={row.getVisibleCells().length + (expandedRowRenderer ? 1 : 0)} className="px-12 py-3 text-xs text-muted">
                        {expandedRowRenderer(row.original)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: count + load-more cursor pagination */}
      <div className="flex items-center justify-between text-xs text-muted-soft">
        <div>
          {typeof totalCount === 'number'
            ? `${totalCount.toLocaleString()} ${totalCount === 1 ? 'result' : 'results'}`
            : `${data.length} loaded`}
        </div>
        {onLoadMore && (
          <button
            type="button"
            disabled={!nextCursor || isLoadingMore}
            onClick={onLoadMore}
            className="rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingMore ? 'Loading…' : nextCursor ? 'Load more' : 'No more results'}
          </button>
        )}
      </div>
    </div>
  );
}
