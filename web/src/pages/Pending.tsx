import { motion } from 'framer-motion';
import { Hourglass, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';

export function PendingPage() {
  const { user, signOut, refresh } = useAuth();

  return (
    <div className="grid min-h-screen place-items-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass w-full max-w-lg rounded-2xl border border-border p-10 text-center shadow-glass-lg"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-warning/15 text-warning ring-1 ring-warning/40">
          <Hourglass className="h-6 w-6" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">Awaiting approval</h1>
        <p className="mt-3 text-sm text-muted">
          Your account <span className="text-foreground">{user?.email}</span> has been received
          and is queued for an administrator. You'll get access as soon as someone approves you.
        </p>

        <div className="mx-auto mt-8 grid grid-cols-3 gap-3 text-left">
          <Step label="Signed in" done />
          <Step label="Admin review" done={false} active />
          <Step label="Access granted" done={false} />
        </div>

        <div className="mt-10 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Check status
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>

        <p className="mt-8 text-[11px] text-muted-soft">
          Need this expedited? Reach out to your administrator directly.
        </p>
      </motion.div>
    </div>
  );
}

function Step({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <div
      className={[
        'rounded-lg border px-3 py-2 text-xs',
        done
          ? 'border-success/40 bg-success/15 text-success'
          : active
            ? 'border-warning/40 bg-warning/10 text-warning animate-pulse'
            : 'border-border bg-brand-teal-deep/40 text-muted-soft',
      ].join(' ')}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] opacity-80">
        {done ? 'Complete' : active ? 'Pending' : 'Next'}
      </div>
      <div className="mt-0.5 font-semibold text-foreground">{label}</div>
    </div>
  );
}
