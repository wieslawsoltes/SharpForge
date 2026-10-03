/** LangVersion parsing with Roslyn's spellings: 1-14 (optionally `.0`), 7.1, 7.2, 7.3, ISO-1, ISO-2, default, latest, latestMajor and preview. */
export const latestLanguageVersion = 14;
export const previewLanguageVersion = 15;
/** Released language versions in order; minor versions 7.1-7.3 are distinct from 7. */
export const languageVersions = Object.freeze([1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.3, 8, 9, 10, 11, 12, 13, 14]);
const aliases = { 'iso-1': 1, 'iso-2': 2, default: latestLanguageVersion, latest: latestLanguageVersion, latestmajor: latestLanguageVersion };
/** Display form used in diagnostics: `7.3`, `8.0`, `preview`. */
export function displayLanguageVersion(number) {
  return number >= previewLanguageVersion ? 'preview' : Number.isInteger(number) ? (number >= 7 ? number + '.0' : String(number)) : String(number);
}
/**
 * Parses a LangVersion value. Returns { name, number, preview } - `number` is 7.1 for "7.1" and 15 for preview -
 * or null when the value is not a LangVersion Roslyn accepts.
 */
export function parseLanguageVersion(value = 'default') {
  const name = String(value ?? 'default')
    .trim()
    .toLowerCase();
  if (name === 'preview') return { name, number: previewLanguageVersion, preview: true };
  if (Object.hasOwn(aliases, name)) return { name, number: aliases[name], preview: false };
  const match = /^(\d{1,2})(?:\.(\d))?$/.exec(name);
  if (!match) return null;
  const number = Number(match[2] && match[2] !== '0' ? match[1] + '.' + match[2] : match[1]);
  return languageVersions.includes(number) ? { name, number, preview: false } : null;
}
/** The CS1617 diagnostic text for an invalid LangVersion value. */
export function languageVersionDiagnostic(value) {
  return { code: 'CS1617', message: `Invalid option '${value}' for /langversion. Use '/langversion:?' to list supported values.` };
}
/** Parses a LangVersion value and throws for invalid input (the contract of the compiler's languageVersion()). */
export function languageVersion(value = String(latestLanguageVersion)) {
  const parsed = parseLanguageVersion(value ?? String(latestLanguageVersion));
  if (!parsed) {
    const supported = '1-14 (including 7.1, 7.2, 7.3), ISO-1, ISO-2, default, latest, latestMajor and preview (selected C# 15 features)';
    const error = new Error(`Supported LangVersion values are ${supported}; got '${value}'`);
    error.code = 'CS1617';
    throw error;
  }
  return parsed;
}
