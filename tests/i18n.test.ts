import test from 'node:test';
import assert from 'node:assert/strict';
import { it } from '../src/i18n/it.ts';
import { en } from '../src/i18n/en.ts';
import { getLang, locale, resolveLang, setLang, t, tn } from '../src/i18n/index.ts';

test('every Italian key has an English text, and none is empty', () => {
  for (const k of Object.keys(it)) {
    assert.ok(k in en, `missing en: ${k}`);
    assert.ok((en as Record<string, string>)[k].trim(), `empty en: ${k}`);
    assert.ok((it as Record<string, string>)[k].trim(), `empty it: ${k}`);
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(it).sort());
});

test('automatic language follows the system: Italian for it-*, English otherwise', () => {
  assert.equal(resolveLang('auto', 'it-IT'), 'it');
  assert.equal(resolveLang('auto', 'en-US'), 'en');
  assert.equal(resolveLang('auto', 'de-DE'), 'en');
  assert.equal(resolveLang('it', 'en-US'), 'it');
  assert.equal(resolveLang('en', 'it-IT'), 'en');
});

test('t fills placeholders and follows the current language', () => {
  setLang('it');
  assert.equal(getLang(), 'it');
  assert.equal(locale(), 'it-IT');
  assert.equal(t('common.relative.minutes', { n: 5 }), '5 min fa');
  setLang('en');
  assert.equal(locale(), 'en-GB');
  assert.equal(t('common.relative.minutes', { n: 5 }), '5 min ago');
  setLang('it');
});

test('tn picks one or other by count and passes n', () => {
  setLang('en');
  assert.equal(tn('common.problems', 1), '1 problem');
  assert.equal(tn('common.problems', 3), '3 problems');
  setLang('it');
  assert.equal(tn('common.problems', 1), '1 problema');
  assert.equal(tn('common.problems', 3), '3 problemi');
});
