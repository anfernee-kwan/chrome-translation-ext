import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TARGET_LANGUAGE,
  TARGET_LANGUAGES,
  getRuntimeLocaleCandidates,
  matchTargetLanguage,
  resolvePreferredTargetLanguage,
} from '../lib/targetLanguages.js';

test('target languages: includes the expected top 10 options', () => {
  assert.equal(TARGET_LANGUAGES.length, 10);
  assert.deepEqual(
    TARGET_LANGUAGES.map((language) => language.value),
    ['en', 'zh-CN', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ur'],
  );
});

test('matchTargetLanguage: resolves exact and base locale matches', () => {
  assert.equal(matchTargetLanguage('es-MX'), 'es');
  assert.equal(matchTargetLanguage('fr-CA'), 'fr');
  assert.equal(matchTargetLanguage('zh-SG'), 'zh-CN');
});

test('matchTargetLanguage: returns null for unsupported locales', () => {
  assert.equal(matchTargetLanguage('de-DE'), null);
  assert.equal(matchTargetLanguage('ja'), null);
});

test('resolvePreferredTargetLanguage: uses first supported runtime locale', () => {
  assert.equal(resolvePreferredTargetLanguage(['de-DE', 'pt-BR', 'en-US']), 'pt');
});

test('resolvePreferredTargetLanguage: falls back to the default language', () => {
  assert.equal(resolvePreferredTargetLanguage(['de-DE', 'ja-JP']), DEFAULT_TARGET_LANGUAGE);
  assert.equal(resolvePreferredTargetLanguage([]), DEFAULT_TARGET_LANGUAGE);
});

test('getRuntimeLocaleCandidates: prefers chrome UI locale before navigator locales', () => {
  const locales = getRuntimeLocaleCandidates({
    chromeI18n: { getUILanguage: () => 'fr-FR' },
    nav: { languages: ['es-MX', 'en-US'], language: 'en-US' },
  });
  assert.deepEqual(locales, ['fr-FR', 'es-MX', 'en-US', 'en-US']);
});
