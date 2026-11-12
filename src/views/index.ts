import type { ComponentType } from 'react';
import PerTe from './PerTe';
import Progetti from './Progetti';
import Lavori from './Lavori';
import Decisioni from './Decisioni';
import Handoff from './Handoff';
import Salute from './Salute';
import Grafo from './Grafo';
import Ricerca from './Ricerca';

export type SectionId = 'progetti' | 'per-te' | 'lavori' | 'decisioni' | 'handoff' | 'salute' | 'ricerca' | 'grafo' | 'impostazioni';

/** Sections in nav order; position + 1 is the ⌘/Ctrl shortcut digit. */
export const SECTIONS: Array<{ id: SectionId; label: string; View: ComponentType }> = [
  { id: 'progetti', label: 'Progetti', View: Progetti },
  { id: 'per-te', label: 'Per te', View: PerTe },
  { id: 'lavori', label: 'Lavori', View: Lavori },
  { id: 'decisioni', label: 'Decisioni', View: Decisioni },
  { id: 'handoff', label: 'Handoff', View: Handoff },
  { id: 'salute', label: 'Salute', View: Salute },
  { id: 'grafo', label: 'Grafo', View: Grafo },
  { id: 'ricerca', label: 'Ricerca', View: Ricerca },
];
