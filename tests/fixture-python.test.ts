import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePythonForValidator } from './helpers/fixture.ts';

test('resolvePythonForValidator honors PYTHON when set', () => {
  const prev = process.env.PYTHON;
  process.env.PYTHON = '/custom/python3.11';
  try {
    assert.equal(resolvePythonForValidator(), '/custom/python3.11');
  } finally {
    if (prev === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = prev;
  }
});

test('resolvePythonForValidator returns a python3 executable', () => {
  const prev = process.env.PYTHON;
  delete process.env.PYTHON;
  try {
    const exe = resolvePythonForValidator();
    assert.match(exe, /python3(\.\d+)?$/);
  } finally {
    if (prev === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = prev;
  }
});
