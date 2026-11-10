import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SectionId } from '../views';

let clearNavRefImpl: (() => void) | null = null;

/** Clears the section item ref when the open project changes (ProjectProvider is above NavProvider). */
export function clearNavRef() {
  clearNavRefImpl?.();
}

export interface NavState {
  section: SectionId;
  /** Item to select in the section (tracker ID, decision number, page path…), if any. */
  ref: string | null;
  go(section: SectionId, ref?: string | null): void;
}

const NavContext = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ section: SectionId; ref: string | null }>({ section: 'per-te', ref: null });
  const go = useCallback((section: SectionId, ref: string | null = null) => setState({ section, ref }), []);

  useEffect(() => {
    clearNavRefImpl = () => setState((s) => (s.ref === null ? s : { ...s, ref: null }));
    return () => {
      clearNavRefImpl = null;
    };
  }, []);

  return <NavContext.Provider value={{ ...state, go }}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}
