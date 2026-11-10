import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { SectionId } from '../views';

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
  return <NavContext.Provider value={{ ...state, go }}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}
