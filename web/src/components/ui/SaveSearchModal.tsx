import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Mail, MessageSquare, Webhook, Phone, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * SaveSearchModal (#5 in spec shared components) — Search Name input; Email
 * Frequency selector (Never / Real Time / Daily / Weekly / Monthly);
 * Save / Cancel.
 *
 * Plus the four DIFFERENTIATION channels not in HigherGov: Slack, Teams,
 * Webhook, SMS. Spec §DIFFERENTIATION explicitly calls these out as
 * non-negotiable.
 */

export type AlertFrequency = 'never' | 'realtime' | 'daily' | 'weekly' | 'monthly';

export interface SaveSearchConfig {
  name: string;
  alert_frequency: AlertFrequency;
  channels: {
    email: boolean;
    slack: boolean;
    teams: boolean;
    webhook: boolean;
    sms: boolean;
  };
  slack_webhook_url?: string;
  teams_webhook_url?: string;
  custom_webhook_url?: string;
  sms_phone?: string;
  notify_team: boolean;
}

const FREQUENCIES: { id: AlertFrequency; label: string; description: string }[] = [
  { id: 'never',    label: 'Never',     description: 'Save the filter; no alerts' },
  { id: 'realtime', label: 'Real time', description: 'Each new match immediately' },
  { id: 'daily',    label: 'Daily',     description: 'Roll-up at 8am local' },
  { id: 'weekly',   label: 'Weekly',    description: 'Mondays at 8am' },
  { id: 'monthly',  label: 'Monthly',   description: '1st of each month' },
];

export function SaveSearchModal({
  open, onOpenChange, onSave, defaultName, defaultFrequency = 'daily', defaultChannels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (config: SaveSearchConfig) => Promise<void> | void;
  defaultName?: string;
  defaultFrequency?: AlertFrequency;
  defaultChannels?: Partial<SaveSearchConfig['channels']>;
}) {
  const [name, setName] = React.useState(defaultName ?? '');
  const [frequency, setFrequency] = React.useState<AlertFrequency>(defaultFrequency);
  const [channels, setChannels] = React.useState({
    email: defaultChannels?.email ?? true,
    slack: defaultChannels?.slack ?? false,
    teams: defaultChannels?.teams ?? false,
    webhook: defaultChannels?.webhook ?? false,
    sms: defaultChannels?.sms ?? false,
  });
  const [slackUrl, setSlackUrl] = React.useState('');
  const [teamsUrl, setTeamsUrl] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [smsPhone, setSmsPhone] = React.useState('');
  const [notifyTeam, setNotifyTeam] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        alert_frequency: frequency,
        channels,
        slack_webhook_url:  channels.slack   ? slackUrl   : undefined,
        teams_webhook_url:  channels.teams   ? teamsUrl   : undefined,
        custom_webhook_url: channels.webhook ? webhookUrl : undefined,
        sms_phone:          channels.sms     ? smsPhone   : undefined,
        notify_team: notifyTeam,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-brand-teal-deep/95 shadow-glass-lg backdrop-blur-xl">
          <form onSubmit={onSubmit} className="flex max-h-[80vh] flex-col">
            <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <Dialog.Title className="text-base font-bold">Save search</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close" className="rounded-md p-1 text-muted-soft hover:bg-brand-teal-soft/20 hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </header>

            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* Name */}
              <Field label="Search name" required>
                <input
                  type="text" required value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. CDC IT modernization, FY26"
                  className="w-full rounded-md border border-border bg-brand-teal-deep/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-soft/70 focus:border-brand-vermilion focus:outline-none focus:ring-2 focus:ring-brand-vermilion/30"
                />
              </Field>

              {/* Frequency */}
              <Field label="Alert frequency">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {FREQUENCIES.map((f) => (
                    <label
                      key={f.id}
                      className={cn(
                        'flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-left transition-colors',
                        frequency === f.id
                          ? 'border-brand-vermilion/50 bg-brand-vermilion/10'
                          : 'border-border bg-brand-teal-deep/30 hover:border-border/80',
                      )}
                    >
                      <input
                        type="radio" name="frequency" value={f.id}
                        checked={frequency === f.id}
                        onChange={() => setFrequency(f.id)}
                        className="sr-only"
                      />
                      <span className="text-[13px] font-semibold">{f.label}</span>
                      <span className="text-[11px] text-muted-soft">{f.description}</span>
                    </label>
                  ))}
                </div>
              </Field>

              {/* Channels (DIFFERENTIATION — multi-channel) */}
              {frequency !== 'never' && (
                <Field label="Delivery channels">
                  <div className="flex flex-col gap-1.5">
                    <ChannelRow icon={Mail}          label="Email"         on={channels.email}   onChange={(v) => setChannels({ ...channels, email: v })} />
                    <ChannelRow icon={MessageSquare} label="Slack"         on={channels.slack}   onChange={(v) => setChannels({ ...channels, slack: v })}>
                      {channels.slack && <UrlInput value={slackUrl} onChange={setSlackUrl} placeholder="https://hooks.slack.com/services/…" />}
                    </ChannelRow>
                    <ChannelRow icon={MessageSquare} label="Microsoft Teams" on={channels.teams} onChange={(v) => setChannels({ ...channels, teams: v })}>
                      {channels.teams && <UrlInput value={teamsUrl} onChange={setTeamsUrl} placeholder="https://outlook.office.com/webhook/…" />}
                    </ChannelRow>
                    <ChannelRow icon={Webhook}       label="Webhook"       on={channels.webhook} onChange={(v) => setChannels({ ...channels, webhook: v })}>
                      {channels.webhook && <UrlInput value={webhookUrl} onChange={setWebhookUrl} placeholder="https://yourapp.example.com/captureradar/alerts" />}
                    </ChannelRow>
                    <ChannelRow icon={Phone}         label="SMS"           on={channels.sms}     onChange={(v) => setChannels({ ...channels, sms: v })}>
                      {channels.sms && <UrlInput value={smsPhone} onChange={setSmsPhone} placeholder="+1 555 0100" type="tel" />}
                    </ChannelRow>
                  </div>
                </Field>
              )}

              {/* Team toggle */}
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-brand-teal-soft/15">
                <input
                  type="checkbox" checked={notifyTeam} onChange={(e) => setNotifyTeam(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-vermilion"
                />
                Share with my team — visible under Team Searches
              </label>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md border border-border bg-brand-teal-deep/30 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-brand-teal-soft/20">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit" disabled={busy || !name.trim()}
                className="rounded-md bg-gradient-to-br from-brand-vermilion to-brand-vermilion-soft px-3 py-1.5 text-[13px] font-semibold text-foreground shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted-soft">
        {label} {required && <span className="text-brand-vermilion-soft">*</span>}
      </span>
      {children}
    </div>
  );
}

function ChannelRow({
  icon: Icon, label, on, onChange, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; on: boolean; onChange: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-brand-teal-deep/30 p-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-brand-vermilion" />
        <Icon className="h-3.5 w-3.5 text-muted-soft" />
        <span className="text-[13px]">{label}</span>
      </label>
      {children}
    </div>
  );
}

function UrlInput({
  value, onChange, placeholder, type = 'url',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-1.5 w-full rounded border border-border bg-brand-teal-deep/30 px-2 py-1 text-[12px] text-foreground placeholder:text-muted-soft/70"
    />
  );
}
