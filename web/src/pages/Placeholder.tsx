import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export function PlaceholderPage({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={eyebrow ?? 'Coming soon'}
        title={title}
        description="This view is being migrated to the new React shell. Data still flows through the API — the legacy page is offline while we rebuild."
      />
      <div className="glass rounded-2xl border border-dashed border-border p-12 text-center">
        <Construction className="mx-auto h-7 w-7 text-brand-sage" />
        <p className="mt-4 text-sm text-muted">Migration in progress.</p>
      </div>
    </div>
  );
}
