import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { t } from '../i18n';

const Progetti = lazy(() => import('./Progetti'));
const PerTe = lazy(() => import('./PerTe'));
const Lavori = lazy(() => import('./Lavori'));
const Decisioni = lazy(() => import('./Decisioni'));
const Handoff = lazy(() => import('./Handoff'));
const Salute = lazy(() => import('./Salute'));
const Grafo = lazy(() => import('./Grafo'));
const Ricerca = lazy(() => import('./Ricerca'));

export type SectionId = 'progetti' | 'per-te' | 'lavori' | 'decisioni' | 'handoff' | 'salute' | 'ricerca' | 'grafo' | 'impostazioni' | 'primi-passi';

/** Sections in nav order; the position is the ⌘/Ctrl shortcut digit (Progetti ⌘0, Per te ⌘1…). */
export const SECTIONS: Array<{ id: SectionId; label: string; View: LazyExoticComponent<ComponentType> }> = [
  { id: 'progetti', get label() { return t('shell.section.progetti'); }, View: Progetti },
  { id: 'per-te', get label() { return t('shell.section.per-te'); }, View: PerTe },
  { id: 'lavori', get label() { return t('shell.section.lavori'); }, View: Lavori },
  { id: 'decisioni', get label() { return t('shell.section.decisioni'); }, View: Decisioni },
  { id: 'handoff', get label() { return t('shell.section.handoff'); }, View: Handoff },
  { id: 'salute', get label() { return t('shell.section.salute'); }, View: Salute },
  { id: 'grafo', get label() { return t('shell.section.grafo'); }, View: Grafo },
  { id: 'ricerca', get label() { return t('shell.section.ricerca'); }, View: Ricerca },
];
