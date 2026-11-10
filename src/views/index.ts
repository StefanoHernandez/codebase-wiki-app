import type { ComponentType } from 'react';
import PerTe from './PerTe';
import Lavori from './Lavori';
import Decisioni from './Decisioni';
import Handoff from './Handoff';
import Salute from './Salute';
import Grafo from './Grafo';

export type SectionId = 'per-te' | 'lavori' | 'decisioni' | 'handoff' | 'salute' | 'grafo';

/** Sections in nav order; position + 1 is the ⌘/Ctrl shortcut digit. */
export const SECTIONS: Array<{ id: SectionId; label: string; View: ComponentType }> = [
  { id: 'per-te', label: 'Per te', View: PerTe },
  { id: 'lavori', label: 'Lavori', View: Lavori },
  { id: 'decisioni', label: 'Decisioni', View: Decisioni },
  { id: 'handoff', label: 'Handoff', View: Handoff },
  { id: 'salute', label: 'Salute', View: Salute },
  { id: 'grafo', label: 'Grafo', View: Grafo },
];
