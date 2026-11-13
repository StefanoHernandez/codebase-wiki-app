import type { it } from './it.ts';
import { common } from './en/common.ts';

export const en: Record<keyof typeof it, string> = {
  ...common,
};
