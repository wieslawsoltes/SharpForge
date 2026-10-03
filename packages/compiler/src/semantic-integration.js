/**
 * Reconciles the execution pipeline with the semantic analysis of SF-A02-E01.
 *
 * The bytecode profile executes a subset of C#. A program outside that subset used to get only profile diagnostics
 * (SF1xxx/SF2xxx "not implemented in this profile") plus whatever errors the string-typed binder produced while
 * stumbling over the constructs it does not know. With the type system in place the compiler can say more:
 *   - the program is not valid C#: report the diagnostics a C# compiler reports (and no profile noise);
 *   - the program is valid C#: keep the profile diagnostics, drop the stumbling errors, add the semantic warnings and
 *     one SF2200 at emit time naming what the runtime profile cannot execute - the image is never produced;
 *   - the analysis could not decide (it met framework members the closed registry does not list): nothing changes.
 * Programs the profile executes are not analysed here at all, so their images and diagnostics are untouched.
 */
import { diagnostic } from '@sharpforge/text';
import { SemanticAnalysis } from './semantic-analysis.js';
import { SymbolKind } from './symbols/types.js';
import { formatMessage } from './diagnostics/codes.js';

/** Profile diagnostics that mark a construct the execution profile cannot run (as opposed to option and API errors). */
export const isProfileConstructDiagnostic = code =>
  /^SF1\d{3}$/.test(code) || /^SF20(0[1-7]|1[0-3]|9[89])$/.test(code) || /^SF214[1-3]$/.test(code);
/** Diagnostics the legacy pipeline owns whatever the semantic analysis says: entry point, options, CIL. */
const pipelineCodes = new Set([
  'CS5001',
  'CS0017',
  'CS0028',
  'CS7022',
  'CS8892',
  'CS1555',
  'CS1558',
  'CS4009',
  'CS1617',
  'CS2019',
  'CS8630',
  'CS8636',
  'CS1900',
  'CS2029',
  'CS2017',
  'CS8203',
  'CS7088',
  'CS2007',
  'SF2008',
  'SF2009',
  'SF2140',
  'SF3001',
]);
const adapterPseudo = d =>
  (d.code === 'CS1014' && /init is not supported/.test(d.message)) || (d.code === 'CS0528' && /Duplicate IDisposable/.test(d.message));
const constructNames = {
  SF1003: '64-bit and unsigned integer literals',
  SF1004: 'integer literals outside Int32',
  SF1005: 'float and decimal literals',
  SF1010: 'struct, interface, enum, delegate and record declarations',
  SF1011: 'virtual, abstract, override and other member modifiers',
  SF1012: 'user-defined generics',
  SF1013: 'nullable types',
  SF1014: 'base classes and interfaces',
  SF1015: 'nested types',
  SF1017: 'ref, out, in and named arguments',
  SF1018: 'declaration forms outside the profile',
  SF1019: 'multi-dimensional arrays and type forms outside the profile',
  SF2001: 'const and readonly fields',
  SF2002: 'typed exception handlers',
  SF2003: 'char values',
  SF2004: 'integers outside Int32',
  SF2005: 'indexers',
  SF2006: 'casts across class hierarchies',
  SF2098: 'expressions outside the profile',
  SF2099: 'statements outside the profile',
  SF2141: 'null-conditional access as a value',
};
// A diagnostic's arguments matter: distinct features can share a version code and source span.
const key = d => d.code + '|' + d.uri + '|' + d.start + '|' + d.length + '|' + d.message;

function internalFailure(compilation, error) {
  const source = compilation.files[0]?.source;
  const reason = String(error?.message ?? error).split('\n')[0];
  return diagnostic(source, 0, 1, 'SF2201', formatMessage('SF2201', [reason]), 'warning');
}

/**
 * @param compilation the Compilation after its pipeline ran  @param {object[]} featureDiagnostics parser-level version gates
 * @returns {null|{diagnostics:object[],semantic:object}} the reconciled diagnostic list, or null when nothing changes
 */
export function reconcileWithSemanticAnalysis(compilation, featureDiagnostics = []) {
  const legacy = compilation.diagnostics,
    files = compilation.inputFiles,
    hasReferences = !!compilation.options.references?.length;
  const profile = legacy.filter(d => isProfileConstructDiagnostic(d.code));
  if (!profile.length && !(hasReferences && legacy.some(d => d.severity === 'error'))) return null;
  if (!files.every(f => f.syntax)) return null;
  let result;
  try {
    result = new SemanticAnalysis(files, {
      ...compilation.options,
      nullableContext: compilation.typedOptions?.nullableContext ?? compilation.options.nullableContext,
    }).run();
  } catch (error) {
    // An internal failure of the analysis must not hide the profile diagnostics the pipeline already has, and it must
    // not pass silently either: it is reported as a diagnostic of its own.
    return { diagnostics: [...legacy, internalFailure(compilation, error)], semantic: null };
  }
  if (result.unsupported) return null;
  const semantic = result.diagnostics,
    errors = semantic.filter(d => d.severity === 'error');
  const syntax = new Set(files.flatMap(f => f.diagnostics.filter(d => /^CS\d{4}$/.test(d.code) && !adapterPseudo(d)).map(key))),
    features = new Set(featureDiagnostics.map(key));
  const hasEntry =
    result.assembly.topLevel.some(i => i.statement) ||
    result.assembly.types.some(t => t.getMembers('Main').some(m => m.kind === SymbolKind.Method && m.isStatic));
  const owned = d => syntax.has(key(d)) || features.has(key(d)) || (pipelineCodes.has(d.code) && !(d.code === 'CS5001' && hasEntry));
  const merge = (base, extra) => {
    const seen = new Set(base.map(key)),
      out = [...base];
    for (const d of extra)
      if (!seen.has(key(d))) {
        seen.add(key(d));
        out.push(d);
      }
    return out;
  };
  if (errors.length) {
    // Not valid C#: the semantic diagnostics replace the errors the string-typed binder derived from the constructs it does not
    // know. The profile diagnostics stay (the program still names constructs the profile lacks), except a literal-range one
    // that sits on the very literal a C# error is reported for (one diagnostic per literal).
    const literalCodes = new Set(['SF1003', 'SF1004', 'SF1005', 'SF2004']);
    const keptProfile = profile.filter(p => !(literalCodes.has(p.code) && errors.some(e => e.uri === p.uri && e.start === p.start)));
    return {
      diagnostics: merge([...legacy.filter(owned), ...keptProfile], semantic).sort((a, b) => (a.uri === b.uri ? a.start - b.start : 0)),
      semantic: result,
    };
  }
  if (result.incomplete) return null;
  // Valid C# that the runtime profile cannot execute.
  const names = [...new Set(profile.map(d => constructNames[d.code] ?? d.code))];
  const first = profile[0],
    source = compilation.sources.get(first?.uri) ?? compilation.files[0]?.source;
  const kept = legacy.filter(d => (owned(d) && !(d.code === 'CS5001')) || isProfileConstructDiagnostic(d.code));
  const diagnostics = merge(kept, semantic);
  if (first && source)
    diagnostics.push(diagnostic(source, first.start, first.length, 'SF2200', formatMessage('SF2200', [names.join('; ')]), 'error'));
  return { diagnostics, semantic: result };
}
