/**
 * Interceptors (C# 12 preview, stable in C# 14; SF-A02-T80). Policy: diagnostics only. A method marked
 * `[InterceptsLocation]` replaces a call at another source location; Roslyn accepts the attribute only in a namespace
 * the project lists in `InterceptorsNamespaces`. SharpForge has no such option, so the attribute is always rejected,
 * with the diagnostics Roslyn gives for a project that does not enable the feature:
 *
 *   CS9232  `InterceptsLocation(version, data)` with a version other than 1
 *   CS9231  the data is not base64 for at least a 16-byte checksum and a 4-byte position
 *   CS9206  the interceptor is declared in the global namespace
 *   CS9137  the feature is not enabled in the interceptor's namespace
 *
 * No call is ever redirected: a program that has the attribute does not compile, so it cannot run un-intercepted.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { attributesNamed } from './bound-attributes.js';

const interceptsLocationAttribute = 'System.Runtime.CompilerServices.InterceptsLocationAttribute';
const checksumBytes = 16,
  positionBytes = 4;

const constantOf = argument => argument?.constantValue?.value;

/** The number of bytes `text` encodes as base64, or -1 when it is not base64. */
function base64Length(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return -1;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

/** The names of the namespaces a symbol is declared in, outermost first. */
function namespaceNames(symbol) {
  const names = [];
  for (let n = symbol.containingNamespace; n && !n.isGlobalNamespace; n = n.containingNamespace) names.unshift(n.name);
  return names;
}

/**
 * The diagnostics of the `[InterceptsLocation]` attributes of one method.
 * @returns {{at:object, code:string, args:any[]}[]} `at` is the attribute name or the whole attribute, as in Roslyn
 */
export function checkInterceptor(method) {
  const rows = [];
  for (const attribute of attributesNamed(method, interceptsLocationAttribute)) {
    const [first, second] = attribute.arguments,
      version = constantOf(first);
    if (attribute.arguments.length === 2 && typeof version === 'number') {
      if (version !== 1) {
        rows.push({ at: attribute.syntax.name, code: DiagnosticId.CS9232, args: [version] });
        continue;
      }
      if (base64Length(constantOf(second)) < checksumBytes + positionBytes) {
        rows.push({ at: attribute.syntax.name, code: DiagnosticId.CS9231, args: [] });
        continue;
      }
    }
    const names = namespaceNames(method.containingType);
    if (!names.length) rows.push({ at: attribute.syntax, code: DiagnosticId.CS9206, args: [] });
    else {
      const property = `<InterceptorsNamespaces>$(InterceptorsNamespaces);${names.join('.')}</InterceptorsNamespaces>`;
      rows.push({ at: attribute.syntax, code: DiagnosticId.CS9137, args: [property] });
    }
  }
  return rows;
}
