import test from 'node:test';
import assert from 'node:assert/strict';
import { trustTier } from '../src/lib/trust.ts';

test('trustTier: no verification is unverified, regardless of source changes', () => {
  assert.equal(trustTier({ verified: [] }, false), 'unverified');
  assert.equal(trustTier({ verified: [] }, true), 'unverified');
});

test('trustTier: only non-human verifiers are machine-confirmed, any human: verifier is human-reviewed', () => {
  assert.equal(trustTier({ verified: [{ by: 'claude-code/opus', at: '2026-01-01T00:00:00Z' }] }, false), 'machine-confirmed');
  assert.equal(
    trustTier(
      {
        verified: [
          { by: 'claude-code/opus', at: '2026-01-01T00:00:00Z' },
          { by: 'human:stefano', at: '2026-01-02T00:00:00Z', commit: 'abc1234' },
        ],
      },
      false
    ),
    'human-reviewed'
  );
});

test('trustTier: verified pages whose sources changed since verification are stale-verified', () => {
  assert.equal(trustTier({ verified: [{ by: 'human:stefano', at: '2026-01-02T00:00:00Z' }] }, true), 'stale-verified');
  assert.equal(trustTier({ verified: [{ by: 'codex', at: '2026-01-02T00:00:00Z' }] }, true), 'stale-verified');
});
