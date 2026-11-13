import type { it } from './it.ts';
import { common } from './en/common.ts';
import { esplora } from './en/esplora.ts';
import { impostazioni } from './en/impostazioni.ts';
import { lavori } from './en/lavori.ts';
import { revisione } from './en/revisione.ts';
import { shell } from './en/shell.ts';

export const en: Record<keyof typeof it, string> = {
  ...common,
  ...shell,
  ...lavori,
  ...revisione,
  ...impostazioni,
  ...esplora,
};
