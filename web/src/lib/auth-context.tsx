import * as React from 'react';
import { api, ApiError, apiBase } from './api';

export type Role = 'pending' | 'user' | 'admin' | 'rejected';

export interface AppUser {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: 'google' | 'microsoft';
  provider_sub: string;
  role: Role;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'pending'
  | 'rejected'
  | 'approved';

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (provider: 'google' | 'microsoft') => void;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

function deriveStatus(user: AppUser | null): AuthStatus {
  if (!user) return 'unauthenticated';
  if (user.role === 'admin' || user.role === 'user') return 'approved';
  if (user.role === 'pending') return 'pending';
  if (user.role === 'rejected') return 'rejected';
  return 'unauthenticated';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AppUser | null>(null);
  const [status, setStatus] = React.useState<AuthStatus>('loading');
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      // /auth/me returns { authenticated: false } or { authenticated: true, user: {...} }
      const me = await api.get<{ authenticated: boolean; user?: AppUser }>('/auth/me');
      const u = me.authenticated && me.user ? me.user : null;
      setUser(u);
      setStatus(deriveStatus(u));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setStatus('unauthenticated');
        setError(null);
        return;
      }
      setError(e instanceof Error ? e.message : 'Authentication check failed');
      setStatus('unauthenticated');
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = React.useCallback((provider: 'google' | 'microsoft') => {
    // Same-origin top-level navigation. The Pages Function at this origin
    // forwards the request to the worker, which 302s out to Google/Microsoft.
    // After OAuth, the provider redirects back to this same origin (configured
    // as the OAuth redirect_uri), the Pages Function forwards the callback to
    // the worker, the worker mints a session cookie which the browser stores
    // first-party. End result: cookie sticks.
    const base = apiBase(); // empty string in production
    const next = encodeURIComponent(window.location.origin);
    window.location.href = `${base}/auth/${provider}?next=${next}`;
  }, []);

  const signOut = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value: AuthContextValue = { status, user, error, refresh, signIn, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = React.useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
