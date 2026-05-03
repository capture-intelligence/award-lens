import * as React from 'react';

// Single source of truth for "which award is the user currently focused on".
//
// Two consumers read from here:
//   1. <AwardDetail> — renders the full record in the left-side panel.
//   2. The AI chat — sends a flat subset to /ai/v2/ask as `context`, and
//      uses `award_id` for similarity-search recall.
//
// Two writers set it:
//   - Analytics (tree leaf click, summary row click)
//   - Chat results table (click a row in the chat's result grid)
//
// Lifting the state to a context lets the chat (rendered at App level) and
// Analytics (a route-mounted page) share it without prop drilling.

export type SelectedAward = Record<string, unknown> | null;

type CtxValue = {
  selected: SelectedAward;
  setSelected: React.Dispatch<React.SetStateAction<SelectedAward>>;
};

const Ctx = React.createContext<CtxValue>({
  selected: null,
  setSelected: () => {},
});

export function AiAwardProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<SelectedAward>(null);
  const value = React.useMemo(() => ({ selected, setSelected }), [selected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSelectedAward    = () => React.useContext(Ctx).selected;
export const useSetSelectedAward = () => React.useContext(Ctx).setSelected;

// Flat subset shipped to the AI worker as `context`. Derived from
// `selectedAward` so there's no separate state to keep in sync.
export type AiAward = {
  award_id?:        string;
  description?:     string;
  naics_code?:      string;
  psc_code?:        string;
  psc_description?: string;
} | null;

export function useAiAward(): AiAward {
  const sel = useSelectedAward();
  return React.useMemo<AiAward>(() => {
    if (!sel) return null;
    const s = (k: string): string | undefined => {
      const v = sel[k];
      return v === undefined || v === null || v === '' ? undefined : String(v);
    };
    return {
      award_id:        s('award_id'),
      description:     s('description'),
      naics_code:      s('naics_code'),
      psc_code:        s('psc_code'),
      psc_description: s('psc_description'),
    };
  }, [sel]);
}
