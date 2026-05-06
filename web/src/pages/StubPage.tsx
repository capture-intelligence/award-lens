import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Construction } from 'lucide-react';

/**
 * Generic placeholder for spec routes whose page implementation hasn't
 * landed yet. Auto-titles itself from the URL path so every route has a
 * sensible page even before its real implementation arrives.
 *
 * Each list page in the spec replaces this with a real DataTable +
 * FilterPanel + EntityDetailLayout combo.
 */
export function StubPage({ title, eyebrow, message }: { title?: string; eyebrow?: string; message?: string }) {
  const { pathname } = useLocation();
  const auto = humanize(pathname);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow ?? 'Phase 1'}
        title={title ?? auto}
        description={message ?? 'This page is scaffolded — list, detail, filters, and exports are wired into the API. Ingestion job will populate it on the next run.'}
      />
      <EmptyState
        icon={Construction}
        title="No data yet."
        message="The schema and API for this entity exist; ingestion seeds and live runs queue up next. Check Saved Searches to be notified when results land."
      />
    </div>
  );
}

function humanize(path: string): string {
  const seg = path.split('/').filter(Boolean)[0] ?? 'home';
  return seg
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
