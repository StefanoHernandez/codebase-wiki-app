import type { common as it } from '../it/common.ts';

export const common: Record<keyof typeof it, string> = {
  'common.relative.now': 'now',
  'common.relative.minutes': '{n} min ago',
  'common.relative.hours': '{n} h ago',
  'common.relative.days': '{n} d ago',
  'common.problems.one': '{n} problem',
  'common.problems.other': '{n} problems',
  'common.language': 'Language',
  'common.language.auto': 'Automatic',
  'common.language.hint': "Automatic follows the Mac's language.",
};
