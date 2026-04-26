import { motion } from 'framer-motion';
import { ShieldX, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth-context';

export function RejectedPage() {
  const { user, signOut } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass w-full max-w-lg rounded-2xl border border-brand-vermilion/30 p-10 text-center shadow-glass-lg"
      >
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-vermilion/15 text-brand-vermilion-soft ring-1 ring-brand-vermilion/40">
          <ShieldX className="h-6 w-6" />
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">Access not approved</h1>
        <p className="mt-3 text-sm text-muted">
          Access for <span className="text-foreground">{user?.email}</span> has been declined.
          If you believe this was an error, contact your administrator.
        </p>

        <div className="mt-10 flex justify-center">
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
