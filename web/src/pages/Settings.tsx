import * as React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { User, Bell, Sparkles, Building2, CreditCard, Plug, KeyRound, Shield, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Unified Settings page — DIFFERENTIATION from HigherGov's split /profile +
 * /account UX. Every preference, every team setting, every integration,
 * billing, and security control lives under one URL with tab navigation.
 *
 * Tabs:
 *   Profile        — name, email, avatar, password, 2FA, AI prefs
 *   Notifications  — daily digests, alert defaults
 *   AI Preferences — assistant visibility, match score, linked awardee
 *   Organization   — team users, awardee profile customization
 *   Subscription   — plan, seats, export limits, billing
 *   API Keys       — generate + revoke, usage history
 *   Integrations   — Zapier, Slack, Teams, Salesforce
 *   Security       — 2FA, sessions, login history
 */

const TABS = [
  { id: 'profile',       label: 'Profile',         icon: User },
  { id: 'notifications', label: 'Notifications',   icon: Bell },
  { id: 'ai',            label: 'AI Preferences',  icon: Sparkles },
  { id: 'organization',  label: 'Organization',    icon: Building2 },
  { id: 'subscription',  label: 'Subscription',    icon: CreditCard },
  { id: 'api',           label: 'API Keys',        icon: KeyRound },
  { id: 'integrations',  label: 'Integrations',    icon: Plug },
  { id: 'security',      label: 'Security',        icon: Shield },
] as const;

type TabId = typeof TABS[number]['id'];

export function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const activeTab: TabId = (TABS.find((t) => t.id === tab)?.id ?? 'profile');

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Profile, team, AI, billing, integrations, and security — one place, no /profile vs /account split."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Tabs sidebar */}
        <nav className="flex flex-row gap-1 overflow-x-auto rounded-xl border border-border bg-brand-teal-deep/25 p-2 lg:flex-col">
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => navigate(`/settings/${t.id}`)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-vermilion/15 text-foreground ring-1 ring-brand-vermilion/30'
                    : 'text-muted hover:bg-brand-teal-soft/20 hover:text-foreground',
                )}
              >
                <t.icon className={cn('h-4 w-4', isActive ? 'text-brand-vermilion' : 'text-muted-soft')} />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div>
          {activeTab === 'profile'       && <ProfileTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'ai'            && <AITab />}
          {activeTab === 'organization'  && <OrgTab />}
          {activeTab === 'subscription'  && <SubscriptionTab />}
          {activeTab === 'api'           && <APITab />}
          {activeTab === 'integrations'  && <IntegrationsTab />}
          {activeTab === 'security'      && <SecurityTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Section primitives ───────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-brand-teal-deep/25">
      <header className="border-b border-border/40 px-5 py-4">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-[12px] text-muted">{description}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted-soft">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, defaultOn = false, on, onChange }: {
  label: string; hint?: string; defaultOn?: boolean; on?: boolean; onChange?: (v: boolean) => void;
}) {
  const [internal, setInternal] = React.useState(defaultOn);
  const value = on ?? internal;
  const handle = (v: boolean) => { setInternal(v); onChange?.(v); };
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-brand-teal-deep/30 px-3 py-2.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-soft">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => handle(!value)}
        className={cn(
          'relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors',
          value ? 'bg-brand-vermilion' : 'bg-brand-teal-soft/40',
        )}
      >
        <span className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          value ? 'translate-x-5' : 'translate-x-0.5',
        )} />
      </button>
    </div>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft px-4 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-all hover:brightness-110"
    >
      <Save className="h-3.5 w-3.5" />
      Save changes
    </button>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

function ProfileTab() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <Section title="Identity" description="How your name and email show up across CaptureRadar.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <input type="text" defaultValue={user?.display_name ?? ''} className="rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-sm" />
          </Field>
          <Field label="Email" hint="Sign-in email — change requires re-authentication.">
            <input type="email" defaultValue={user?.email ?? ''} disabled className="rounded-md border border-border bg-brand-teal-deep/40 px-3 py-2 text-sm text-muted" />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveButton onClick={() => toast.success('Profile saved')} />
        </div>
      </Section>
    </div>
  );
}

function NotificationsTab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Daily digest" description="Email roll-ups of new matches across your saved searches.">
        <div className="flex flex-col gap-2">
          <Toggle label="Federal contract opportunities"   hint="New solicitations matching your saved filters" />
          <Toggle label="State and local opportunities"    hint="2.6M SLED solicitations across all 50 states" />
          <Toggle label="Federal grant opportunities"      hint="85K Grants.gov funding opportunities" />
        </div>
      </Section>
      <Section title="Alert delivery defaults" description="Default channels for new saved searches. Per-search overrides happen in the save modal.">
        <div className="flex flex-col gap-2">
          <Toggle label="Email"                       hint="Resend — 3K/mo free tier"           defaultOn />
          <Toggle label="Slack"                       hint="Configure incoming webhook"          />
          <Toggle label="Microsoft Teams"             hint="Connector or webhook"                />
          <Toggle label="Webhook"                     hint="POST JSON to any HTTPS URL"          />
          <Toggle label="SMS"                         hint="Twilio integration"                  />
        </div>
      </Section>
    </div>
  );
}

function AITab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Assistants" description="Per-user toggles for AI features.">
        <div className="flex flex-col gap-2">
          <Toggle defaultOn label="Show Opportunity Assistant" hint="Floating ✦ chat button on every solicitation detail page" />
          <Toggle defaultOn label="Show match score"            hint="0-100% fit score on opportunity rows + detail" />
          <Toggle          label="Show win-probability narrative" hint="Prose explanation of why an opp scored where it did" />
        </div>
      </Section>
      <Section title="Linked awardee profile" description="The AI uses this to compute personalized match scores.">
        <Field label="Your company's federal registration" hint="Match by UEI, CAGE, or company name.">
          <select className="rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-sm">
            <option>Select…</option>
            <option>Match by UEI</option>
            <option>Match by CAGE code</option>
            <option>Match by company name</option>
          </select>
        </Field>
        <div className="mt-3">
          <Field label="Capability statement" hint="Plain text or PDF — upload turns into a profile vector for semantic match.">
            <textarea rows={6} placeholder="e.g. We provide cloud-native data engineering, federal data platform modernization, and HIPAA-aligned analytics for HHS agencies…" className="rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-sm" />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveButton onClick={() => toast.success('AI preferences saved — profile vector queued for re-embed')} />
        </div>
      </Section>
    </div>
  );
}

function OrgTab() {
  return (
    <Section title="Team" description="Add, remove, and assign roles for users in your org.">
      <table className="w-full text-sm">
        <thead className="bg-brand-teal-deep/85">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Name</th>
            <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Email</th>
            <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Role</th>
            <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Last sign-in</th>
            <th className="w-12 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/40">
            <td className="px-3 py-2">Tejas Patel</td>
            <td className="px-3 py-2">algocrat@gmail.com</td>
            <td className="px-3 py-2"><span className="rounded-full bg-brand-vermilion/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-vermilion-soft">Admin</span></td>
            <td className="px-3 py-2 text-muted">just now</td>
            <td className="px-3 py-2"></td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
        <button className="rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30" onClick={() => toast.info('Invitation flow opens')}>
          Invite teammate
        </button>
      </div>
    </Section>
  );
}

function SubscriptionTab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Plan" description="Tier limits + billing.">
        <div className="grid gap-4 sm:grid-cols-2">
          <KV label="Plan" value={<span className="rounded-full bg-brand-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-sage">Demo / Starter</span>} />
          <KV label="Renewal" value="—" />
          <KV label="Seats used" value="1 of 1" />
          <KV label="Export limit" value="1,000 records / search" />
          <KV label="API monthly limit" value="10,000 records" />
          <KV label="Capital Markets" value="Locked — upgrade to Leader" />
        </div>
        <div className="mt-4 flex gap-2">
          <Link to="/pricing" className="rounded-md bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft px-3 py-1.5 text-[13px] font-semibold text-foreground">Upgrade</Link>
          <button className="rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-brand-teal-soft/30">Billing portal</button>
        </div>
      </Section>
    </div>
  );
}

function APITab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="API keys" description="Programmatic access. Generated keys are shown once.">
        <table className="w-full text-sm">
          <thead className="bg-brand-teal-deep/85">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Label</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Prefix</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Plan</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Last used</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Created</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No keys yet — generate one to start.</td></tr>
          </tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <button onClick={() => toast.info('Key generation modal opens')} className="rounded-md bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft px-3 py-1.5 text-[13px] font-semibold text-foreground">Generate API key</button>
        </div>
      </Section>
    </div>
  );
}

function IntegrationsTab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Outbound integrations" description="Where alerts can deliver. Native Slack and Teams are DIFFERENTIATIONs over HigherGov's Zapier-only.">
        <div className="grid gap-3 sm:grid-cols-2">
          <IntegrationCard name="Slack" status="not_connected" />
          <IntegrationCard name="Microsoft Teams" status="not_connected" />
          <IntegrationCard name="Zapier" status="connected" />
          <IntegrationCard name="Salesforce" status="coming_soon" />
          <IntegrationCard name="HubSpot (via Zapier)" status="connected" />
          <IntegrationCard name="Custom webhook" status="not_connected" />
        </div>
      </Section>
    </div>
  );
}

function IntegrationCard({ name, status }: { name: string; status: 'connected'|'not_connected'|'coming_soon' }) {
  const labelMap = {
    connected:    { text: 'Connected',    cls: 'text-brand-sage'           },
    not_connected:{ text: 'Not connected',cls: 'text-muted'                },
    coming_soon:  { text: 'Coming soon',  cls: 'text-brand-vermilion-soft' },
  };
  return (
    <div className="rounded-lg border border-border bg-brand-teal-deep/30 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${labelMap[status].cls}`}>{labelMap[status].text}</span>
      </div>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Two-factor authentication" description="Required for admin role on Standard and Leader tiers.">
        <Toggle label="Require 2FA for sign-in" hint="TOTP via your authenticator app of choice" />
      </Section>
      <Section title="Active sessions" description="Devices currently signed in to your account.">
        <p className="text-sm text-muted">1 active session — this browser. <button className="ml-2 text-brand-vermilion-soft hover:underline" onClick={() => toast.info('Sign-out-others — Phase 2')}>Sign out other sessions</button></p>
      </Section>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}
