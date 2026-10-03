import { createHash } from 'node:crypto';
import { createBrowserCsp } from '../../../packages/network/src/index.js';

const escapeAttribute = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export const connectOrigins = (text = '') => text.split(/[,\s]+/).filter(Boolean);
export const scriptHash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** The network policy owns every directive; standalone adds only its exact, generated script bytes. */
export function browserCsp({ allowedOrigins = [], inlineScript } = {}) {
  const policy = createBrowserCsp(allowedOrigins);
  return inlineScript === undefined ? policy : policy.replace(/script-src ([^;]+)/, (_, sources) =>
    `script-src ${sources} ${scriptHash(inlineScript)}`);
}

// CSP3 section 3.3: these directives cannot be delivered using a meta element.
export function metaCsp(policy) {
  return policy.split(';').map(part => part.trim())
    .filter(part => part && !/^(?:frame-ancestors|sandbox|report-uri|report-to)(?:\s|$)/i.test(part)).join('; ');
}

/** Only the generated marker is replaced. Unexpected pre-existing policies fail instead of being discarded. */
export function installCsp(html, options = {}) {
  const marker = /<meta\s+data-sharpforge-csp="(?:browser|standalone)"\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*>\s*/gi;
  const clean = html.replace(marker, '');
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy\b/i.test(clean)) {
    throw new Error('Unexpected existing CSP meta policy');
  }
  if (!/<head(?:\s[^>]*)?>/i.test(clean)) throw new Error('HTML document has no head');
  const kind = options.inlineScript === undefined ? 'browser' : 'standalone';
  const tag = `<meta data-sharpforge-csp="${kind}" http-equiv="Content-Security-Policy" ` +
    `content="${escapeAttribute(metaCsp(browserCsp(options)))}">`;
  return clean.replace(/(<head(?:\s[^>]*)?>)\s*/i, (_, head) => `${head}\n${tag}\n`);
}

/** A generated standalone has one inline entry script; hosted responses must allow those same bytes. */
export function standaloneScript(html) {
  if (!/<meta\s+data-sharpforge-csp="standalone"\s/i.test(html)) return undefined;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== 1 || /\bsrc\s*=/i.test(scripts[0][1])) throw new Error('Invalid standalone entry script');
  return scripts[0][2];
}

/** HTTP enforces the header for every HTML response; refresh only our generated metadata. */
export function hostedHtml(html, { allowedOrigins = [] } = {}) {
  const options = { allowedOrigins, inlineScript: standaloneScript(html) };
  const generated = /<meta\s+data-sharpforge-csp="(?:browser|standalone)"\s/i.test(html);
  return { body: generated ? installCsp(html, options) : html, policy: browserCsp(options) };
}
