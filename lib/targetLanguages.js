export const DEFAULT_TARGET_LANGUAGE = 'zh-CN';

export const TARGET_LANGUAGES = [
  {
    value: 'en',
    label: 'English',
    promptLabel: 'English',
    speakerCount: '1.493B',
  },
  {
    value: 'zh-CN',
    label: 'Mandarin Chinese (Simplified)',
    promptLabel: 'Simplified Chinese',
    speakerCount: '1.183B',
    aliases: ['zh', 'zh-cn', 'zh-sg'],
  },
  {
    value: 'hi',
    label: 'Hindi',
    promptLabel: 'Hindi',
    speakerCount: '611M',
  },
  {
    value: 'es',
    label: 'Spanish',
    promptLabel: 'Spanish',
    speakerCount: '561M',
  },
  {
    value: 'ar',
    label: 'Arabic (Modern Standard)',
    promptLabel: 'Modern Standard Arabic',
    speakerCount: '335M',
  },
  {
    value: 'fr',
    label: 'French',
    promptLabel: 'French',
    speakerCount: '334M',
  },
  {
    value: 'bn',
    label: 'Bengali',
    promptLabel: 'Bengali',
    speakerCount: '274M',
  },
  {
    value: 'pt',
    label: 'Portuguese',
    promptLabel: 'Portuguese',
    speakerCount: '269M',
  },
  {
    value: 'id',
    label: 'Indonesian',
    promptLabel: 'Indonesian',
    speakerCount: '255M',
  },
  {
    value: 'ur',
    label: 'Urdu',
    promptLabel: 'Urdu',
    speakerCount: '246M',
  },
];

const TARGET_LANGUAGE_BY_VALUE = new Map(
  TARGET_LANGUAGES.map((language) => [language.value.toLowerCase(), language]),
);

const TARGET_LANGUAGE_ALIASES = new Map();
for (const language of TARGET_LANGUAGES) {
  TARGET_LANGUAGE_ALIASES.set(language.value.toLowerCase(), language.value);
  for (const alias of language.aliases || []) {
    TARGET_LANGUAGE_ALIASES.set(alias.toLowerCase(), language.value);
  }
}

export function getTargetLanguage(value) {
  if (!value) return TARGET_LANGUAGES.find((language) => language.value === DEFAULT_TARGET_LANGUAGE);
  return TARGET_LANGUAGE_BY_VALUE.get(String(value).toLowerCase())
    || TARGET_LANGUAGES.find((language) => language.value === DEFAULT_TARGET_LANGUAGE);
}

export function matchTargetLanguage(locale) {
  if (!locale) return null;
  const normalized = String(locale).trim().toLowerCase();
  if (!normalized) return null;
  const exactMatch = TARGET_LANGUAGE_ALIASES.get(normalized);
  if (exactMatch) return exactMatch;
  const [baseLanguage] = normalized.split('-');
  return TARGET_LANGUAGE_ALIASES.get(baseLanguage) || null;
}

export function resolvePreferredTargetLanguage(locales = []) {
  for (const locale of locales) {
    const matched = matchTargetLanguage(locale);
    if (matched) return matched;
  }
  return DEFAULT_TARGET_LANGUAGE;
}

export function getRuntimeLocaleCandidates({
  chromeI18n = globalThis.chrome?.i18n,
  nav = globalThis.navigator,
} = {}) {
  const locales = [];
  if (chromeI18n?.getUILanguage) locales.push(chromeI18n.getUILanguage());
  if (Array.isArray(nav?.languages)) locales.push(...nav.languages);
  if (nav?.language) locales.push(nav.language);
  return locales.filter(Boolean);
}
