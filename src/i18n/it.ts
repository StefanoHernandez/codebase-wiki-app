import { common } from './it/common.ts';
import { esplora } from './it/esplora.ts';
import { impostazioni } from './it/impostazioni.ts';
import { lavori } from './it/lavori.ts';
import { revisione } from './it/revisione.ts';
import { shell } from './it/shell.ts';

/** Italian texts: the reference. Every key must also exist in `en.ts` (enforced by its type). */
export const it = {
  ...common,
  ...shell,
  ...lavori,
  ...revisione,
  ...impostazioni,
  ...esplora,
};
