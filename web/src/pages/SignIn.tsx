import * as React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Sparkles, Layers, Database } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo, Wordmark } from '@/components/ui/Logo';
import { useAuth } from '@/lib/auth-context';

export function SignInPage() {
  const { signIn, error } = useAuth();

  return (
    <div className="relative grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* Left: hero panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-teal-deep via-brand-teal to-brand-teal-deep lg:block">
        <div
          aria-hidden
          className="absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-brand-vermilion/25 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-32 -right-32 h-[32rem] w-[32rem] rounded-full bg-brand-sage/20 blur-3xl"
        />
        <div className="relative flex h-full flex-col justify-between px-14 py-14">
          <div className="flex items-center gap-3">
            <Logo size={44} withGlow />
            <Wordmark size="lg" tagline="Procurement Intelligence" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="max-w-xl"
          >
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-foreground">
              Federal procurement,{' '}
              <span className="bg-gradient-to-r from-brand-vermilion via-brand-vermilion-soft to-brand-cream bg-clip-text text-transparent">
                seen with precision
              </span>
              .
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted">
              AwardLens AI replicates USAspending, SAM.gov, and Grants.gov into a single
              tamper-evident store — then turns it into views you can scope, share, and act on.
            </p>

            <ul className="mt-10 space-y-4">
              <Feature icon={Database}    text="Awards, exclusions, and opportunities refreshed on schedule." />
              <Feature icon={Layers}      text="Curated views — admins scope each one to a department, agency, or office." />
              <Feature icon={ShieldCheck} text="Per-view access control with admin approval and audit trail." />
              <Feature icon={Sparkles}    text="Sub-second analytics with retry-aware ingestion." />
            </ul>
          </motion.div>

          <div className="text-xs text-muted-soft">
            USAspending · SAM.gov · Grants.gov
          </div>
        </div>
      </div>

      {/* Right: sign-in card */}
      <div className="relative flex items-center justify-center px-6 py-16">
        {/* Mobile-only mark — visible when the hero panel is hidden */}
        <div className="absolute left-1/2 top-8 flex -translate-x-1/2 items-center gap-2 lg:hidden">
          <Logo size={32} withGlow />
          <Wordmark size="sm" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="glass w-full max-w-md rounded-2xl border border-border p-8 shadow-glass-lg"
        >
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-sage">
            Sign in
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Welcome to AwardLens AI</h2>
          <p className="mt-2 text-sm text-muted">
            Continue with a federated identity provider. New accounts require admin approval.
          </p>

          {error && (
            <div className="mt-5 rounded-lg border border-brand-vermilion/40 bg-brand-vermilion/15 px-3 py-2 text-xs text-brand-vermilion-soft">
              {error}
            </div>
          )}

          <div className="mt-7 flex flex-col gap-3">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => signIn('google')}
              className="justify-center gap-3"
            >
              <GoogleMark />
              Continue with Google
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => signIn('microsoft')}
              className="justify-center gap-3"
            >
              <MicrosoftMark />
              Continue with Microsoft
            </Button>
          </div>

          <div className="mt-8 text-center text-[11px] text-muted-soft">
            By continuing you agree to access policies set by your administrator.
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-teal-soft/30 text-brand-sage ring-1 ring-brand-sage/30">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm text-muted">{text}</span>
    </li>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        d="M21.6 12.227c0-.696-.063-1.366-.18-2.01H12v3.799h5.387a4.6 4.6 0 0 1-1.997 3.022v2.51h3.232c1.89-1.74 2.978-4.302 2.978-7.32Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.964-.895 6.622-2.452l-3.232-2.51c-.895.6-2.04.955-3.39.955-2.605 0-4.81-1.76-5.6-4.124H2.97v2.59A9.997 9.997 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.4 13.869a6.005 6.005 0 0 1 0-3.838V7.441H2.97a10 10 0 0 0 0 9.118l3.43-2.69Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.91c1.47 0 2.787.505 3.825 1.498l2.867-2.867C16.96 2.984 14.696 2 12 2A9.997 9.997 0 0 0 2.97 7.441l3.43 2.59C7.19 7.67 9.394 5.91 12 5.91Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <rect x="2"  y="2"  width="9" height="9" fill="#F25022" />
      <rect x="13" y="2"  width="9" height="9" fill="#7FBA00" />
      <rect x="2"  y="13" width="9" height="9" fill="#00A4EF" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
