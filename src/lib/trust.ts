import type { Attribution } from '../types/wiki.ts';

export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed' | 'stale-verified';

/**
 * Trust tier of a page. A page verified by a `human:` actor is human-reviewed, otherwise any
 * verification is machine-confirmed. Verified pages whose sources changed since are stale.
 */
export function trustTier(page: { verified: Attribution[] }, changedSourcesSinceVerified: boolean): TrustTier {
  if (page.verified.length === 0) return 'unverified';
  if (changedSourcesSinceVerified) return 'stale-verified';
  return page.verified.some((v) => v.by.startsWith('human:')) ? 'human-reviewed' : 'machine-confirmed';
}
