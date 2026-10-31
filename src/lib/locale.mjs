// The body of pickLocale is serialized into an inline script on the root page,
// so it must stay self-contained: no imports, no references outside the function.

/**
 * Maps the browser's ordered language list to a site locale.
 * @param {readonly string[]} languages navigator.languages
 * @returns {'en'|'zh-tw'|'zh-cn'|'ja'|'ko'}
 */
export function pickLocale(languages) {
  for (const raw of languages || []) {
    const tag = String(raw).toLowerCase();
    const base = tag.split('-')[0];
    if (base === 'zh') {
      if (/hans|-cn|-sg|-my/.test(tag)) return 'zh-cn';
      return 'zh-tw';
    }
    if (base === 'ja') return 'ja';
    if (base === 'ko') return 'ko';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export const LOCALES = ['en', 'zh-tw', 'zh-cn', 'ja', 'ko'];

export const LOCALE_META = {
  en: { lang: 'en', label: 'English', content: 'en' },
  'zh-tw': { lang: 'zh-TW', label: '繁體中文', content: 'zh-TW' },
  'zh-cn': { lang: 'zh-CN', label: '简体中文', content: 'zh-TW' },
  ja: { lang: 'ja', label: '日本語', content: 'en' },
  ko: { lang: 'ko', label: '한국어', content: 'en' },
};
