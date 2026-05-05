import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, FileSpreadsheet, FileText, ClipboardCopy, FileImage, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ExportDropdown (#8 in spec shared components) — CSV / Excel / PDF / Clipboard
 * formats; enforces tier export limits (1K / 20K / 100K); kicks off background
 * job for >500 records with email notification on completion.
 *
 * The actual export job creation lives in onExport — this just produces the
 * menu and signals the chosen format / record count.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'clipboard' | 'image';

export interface ExportDropdownProps {
  totalCount: number;
  /** User's tier export cap. */
  tierLimit: number;
  /** Disable the entire dropdown. */
  disabled?: boolean;
  /** Called with the chosen format; called with undefined if the user is over limit. */
  onExport: (format: ExportFormat, recordCount: number) => void;
  /** Whether the current user can export at all (e.g., trial = false). */
  canExport?: boolean;
  /** Trigger label shown on the button. */
  label?: string;
  className?: string;
}

const FORMATS: { id: ExportFormat; label: string; icon: React.ComponentType<{ className?: string }>; subtitle?: string }[] = [
  { id: 'csv',       label: 'CSV',          icon: FileText,        subtitle: 'Comma-separated values' },
  { id: 'xlsx',      label: 'Excel',        icon: FileSpreadsheet, subtitle: 'Workbook (.xlsx)' },
  { id: 'pdf',       label: 'PDF',          icon: FileImage,       subtitle: 'Print-ready report' },
  { id: 'clipboard', label: 'Clipboard',    icon: ClipboardCopy,   subtitle: 'Visible rows' },
];

export function ExportDropdown({
  totalCount, tierLimit, disabled, onExport, canExport = true, label = 'Export', className,
}: ExportDropdownProps) {
  const overLimit = totalCount > tierLimit;
  const recordCount = Math.min(totalCount, tierLimit);
  const isBackgroundJob = recordCount > 500;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <Download className="h-3.5 w-3.5" />
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end" sideOffset={6}
          className="z-50 min-w-[280px] overflow-hidden rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          {/* Header — record count + tier limit */}
          <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-soft">
            <div className="flex items-center justify-between">
              <span>{totalCount.toLocaleString()} matching</span>
              <span className="text-muted">tier cap {tierLimit.toLocaleString()}</span>
            </div>
            {overLimit && (
              <div className="mt-1 text-brand-vermilion-soft">
                Will export first {tierLimit.toLocaleString()} rows
              </div>
            )}
            {isBackgroundJob && (
              <div className="mt-1 text-muted">
                Background job — you'll get an email when it's ready.
              </div>
            )}
          </div>

          {!canExport ? (
            <DropdownMenu.Item
              className="flex cursor-not-allowed select-none items-start gap-2 rounded-md px-3 py-2.5 text-[13px] text-muted-soft outline-none"
              disabled
            >
              <Lock className="h-4 w-4" />
              <div>
                <div className="font-medium">Export restricted</div>
                <div className="text-[11px] text-muted">Trial accounts can browse but not export. Upgrade to download data.</div>
              </div>
            </DropdownMenu.Item>
          ) : (
            FORMATS.map((f) => (
              <DropdownMenu.Item
                key={f.id}
                className="flex cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-brand-teal-soft/30"
                onSelect={() => onExport(f.id, recordCount)}
              >
                <f.icon className="mt-0.5 h-4 w-4 text-muted-soft" />
                <div>
                  <div className="font-medium">{f.label}</div>
                  {f.subtitle && <div className="text-[11px] text-muted">{f.subtitle}</div>}
                </div>
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
