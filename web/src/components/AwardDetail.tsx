import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ExternalLink, Building2, Calendar, FileText, MapPin, ShieldAlert, DollarSign,
} from 'lucide-react';
import { cn, fmtMoney, fmtDate, fmtInt } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { natureOfWork } from '@/lib/nature-of-work';

/**
 * Slide-over award detail drawer. Shows every column + a USAspending search
 * link so the user can jump to the official record.
 *
 * The USAspending detail page expects an internal id we don't have, so we
 * link to the search results filtered by PIID — close enough that a single
 * click lands them on the award page.
 */
export function AwardDetail({
  award, onClose,
}: {
  award: Record<string, unknown> | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {award && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            key={String(award.award_id)}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-brand-teal-deep/95 backdrop-blur-xl shadow-glass-lg"
          >
            <Header award={award} onClose={onClose} />
            <Body award={award} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Header({
  award, onClose,
}: {
  award: Record<string, unknown>;
  onClose: () => void;
}) {
  const piid = String(award.award_piid ?? '—');
  // Prefer the longer description from /awards/{id}/ when the sidecar has
  // already pulled it; the truncated /search row is a fallback.
  const descLong  = String(award.description_long ?? '').trim();
  const descShort = String(award.description      ?? '').trim();
  const desc = (descLong.length > descShort.length ? descLong : descShort) || '(no description)';
  const value = Number(award.current_value ?? 0);
  const usaspendingUrl = piid !== '—'
    ? `https://www.usaspending.gov/search/?keywords[]=${encodeURIComponent(piid)}`
    : null;

  return (
    <div className="border-b border-border bg-gradient-to-br from-brand-teal-deep via-brand-teal to-brand-teal-deep px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-sage">
            Award detail
          </div>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-foreground">{desc}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-mono text-muted">{piid}</span>
            {award.award_type ? (
              <Badge variant="ghost">{String(award.award_type)}</Badge>
            ) : null}
            {Number(award.is_excluded) === 1 && (
              <Badge variant="danger">Vendor excluded</Badge>
            )}
          </div>
          <div className="mt-3 text-2xl font-black tracking-tight text-brand-vermilion-soft">
            {fmtMoney(value)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-brand-teal-deep/40 text-muted transition-colors hover:bg-brand-teal-soft/30 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {usaspendingUrl && (
        <a
          href={usaspendingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-brand-sage/30 bg-brand-sage/10 px-3 py-2 text-xs font-semibold text-brand-sage transition-colors hover:bg-brand-sage/20"
        >
          View on USAspending.gov
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function Body({ award }: { award: Record<string, unknown> }) {
  const nature = natureOfWork({
    description:        String(award.description       ?? '') || null,
    psc_description:    String(award.psc_description   ?? '') || null,
    psc_code:           String(award.psc_code          ?? '') || null,
    naics_description:  String(award.naics_description ?? '') || null,
    naics_code:         String(award.naics_code        ?? '') || null,
  });

  const sections: Section[] = [
    {
      title: 'Vendor',
      icon: Building2,
      items: [
        { label: 'Name',     value: award.vendor_name },
        { label: 'UEI',      value: award.vendor_uei,  mono: true },
        { label: 'Location', value: locString(award) },
      ],
    },
    {
      title: 'Awarding agency',
      icon: Building2,
      items: [
        { label: 'Agency',     value: award.awarding_agency },
        { label: 'Department', value: award.awarding_department },
      ],
    },
    {
      title: 'Money',
      icon: DollarSign,
      items: [
        { label: 'Current value',  value: award.current_value,    kind: 'money' },
        { label: 'Obligated',      value: award.obligated_amount, kind: 'money' },
        { label: 'Base value',     value: award.base_value,       kind: 'money' },
        { label: 'Currency',       value: award.currency_code },
      ],
    },
    {
      title: 'Dates',
      icon: Calendar,
      items: [
        { label: 'PoP start',     value: award.pop_start_date,        kind: 'date' },
        { label: 'Contract end',  value: award.pop_end_date,          kind: 'date' },
        { label: 'Days to end',   value: daysLabel(award.days_to_contract_end) },
        { label: 'Last modified', value: award.source_last_modified,  kind: 'date' },
      ],
    },
    {
      title: 'Classification',
      icon: FileText,
      items: [
        { label: 'Nature of work',    value: nature, highlight: true },
        { label: 'NAICS',             value: award.naics_code,         mono: true },
        { label: 'NAICS description', value: award.naics_description },
        { label: 'PSC',               value: award.psc_code,           mono: true },
        { label: 'PSC description',   value: award.psc_description },
      ],
    },
    {
      title: 'Place of performance',
      icon: MapPin,
      items: [
        { label: 'Country',           value: award.pop_country },
        { label: 'State',             value: award.pop_state },
        { label: 'City',              value: award.pop_city },
        { label: 'Cong. district',    value: award.pop_district, mono: true },
      ],
    },
    {
      title: 'Status',
      icon: ShieldAlert,
      items: [
        { label: 'Vendor excluded?', value: Number(award.is_excluded) === 1 ? 'YES' : 'No' },
        { label: 'Solicitation ID',  value: award.solicitation_id, mono: true },
        { label: 'Parent PIID',      value: award.parent_piid,     mono: true },
        { label: 'Internal ID',      value: award.award_id,        mono: true },
      ],
    },
  ];

  const modHistory = String(award.mod_history ?? '').trim();

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {sections.map((s) => (
        <SectionBlock key={s.title} {...s} />
      ))}
      {modHistory && <ModHistoryBlock raw={modHistory} />}
    </div>
  );
}

function ModHistoryBlock({ raw }: { raw: string }) {
  // mod_history is sidecar-built: each entry on its own line, separator
  // line `---` between entries. Render as a chronological narrative with
  // visible separators.
  const entries = raw
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
        <FileText className="h-3 w-3" />
        Modification history <span className="text-muted-soft">({entries.length})</span>
      </div>
      <ol className="space-y-2">
        {entries.map((line, i) => (
          <li
            key={`${i}-${line.slice(0, 32)}`}
            className="rounded-lg border border-border/50 bg-brand-teal-deep/30 px-3 py-2 text-xs leading-relaxed text-foreground/90 whitespace-pre-line"
          >
            {line}
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Section {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: Array<{
    label: string;
    value: unknown;
    kind?: 'money' | 'date' | 'int';
    mono?: boolean;
    highlight?: boolean;
  }>;
}

function SectionBlock({ title, icon: Icon, items }: Section) {
  const populated = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
  if (populated.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <dl className="grid gap-2">
        {populated.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-[140px_1fr] items-baseline gap-3 border-b border-border/50 pb-2"
          >
            <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-soft">{item.label}</dt>
            <dd
              className={cn(
                'text-sm leading-snug',
                item.mono       && 'font-mono text-xs text-muted',
                item.highlight  && 'font-semibold text-brand-vermilion-soft',
                !item.mono && !item.highlight && 'text-foreground',
              )}
            >
              {formatItem(item)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatItem(item: Section['items'][number]): string {
  const v = item.value;
  if (v === null || v === undefined || v === '') return '—';
  switch (item.kind) {
    case 'money': return fmtMoney(Number(v));
    case 'date':  return fmtDate(String(v));
    case 'int':   return fmtInt(Number(v));
    default:      return String(v);
  }
}

function locString(a: Record<string, unknown>): string | null {
  const parts = [a.vendor_city, a.vendor_state, a.vendor_country].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(', ') : null;
}

function daysLabel(d: unknown): string | null {
  if (d === null || d === undefined || d === '') return null;
  const n = Number(d);
  if (!Number.isFinite(n)) return null;
  if (n < 0)   return `${Math.abs(n)} days ago`;
  if (n === 0) return 'today';
  return `${n} days from now`;
}
