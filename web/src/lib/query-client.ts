/**
 * TanStack Query client — shared across the app.
 *
 * Defaults are tuned for the CaptureRadar workload: list pages are read-heavy
 * with stable result sets (refresh once per minute), detail pages cache for
 * 5 minutes since AI-precomputed fields don't change at request time.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,           // 1 min
      gcTime:    5 * 60_000,       // 5 min
      retry: (failureCount, err) => {
        // Don't retry 4xx — usually a stable error (auth, validation).
        if (err instanceof Error && /API 4\d\d/.test(err.message)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
