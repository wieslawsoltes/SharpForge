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
import { formatMessage, isFeatureGateCode } from './diagnostics/codes.js';
import { suspiciousUsings, usingDiagnosticClassifier } from './binder/using-check.js';
import { featureDiagnosticCodes, newestLanguageVersion } from './binder/feature-check.js';
import { generateFromSemanticAnalysis, isEntryPointCandidate } from './codegen/semantic/generator.js';
import { needsSemanticRules, semanticRuleCodes } from './semantic/profile-rechecks.js';

/** Profile diagnostics that mark a construct the execution profile cannot run (as opposed to option and API errors). */
export const isProfileConstructDiagnostic = code =>
  /^SF1\d{3}$/.test(code) || /^SF20(0[1-7]|1[0-4]|9[89])$/.test(code) || /^SF214[1-3]$/.test(code);
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
  'CS9273',
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
/** What the pipeline's source-level async rewrite reports when it meets `await` or `async` it cannot rewrite. */
const asyncRewriteCodes = new Set(['CS4032', 'CS1983']);
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
  SF2014: 'static constructors',
  SF2002: 'typed exception handlers',
  SF2003: 'char values',
  SF2004: 'integers outside Int32',
  SF2005: 'indexers',
  SF2006: 'casts across class hierarchies',
  SF2098: 'expressions outside the profile',
  SF2099: 'statements outside the profile',
  SF2141: 'null-conditional access as a value',
};
const key = d => d.code + '|' + d.uri + '|' + d.start + '|' + d.length;

function internalFailure(compilation, error) {
  const source = compilation.files[0]?.source;
  const reason = String(error?.message ?? error).split('\n')[0];
  return diagnostic(source, 0, 1, 'SF2201', formatMessage('SF2201', [reason]), 'warning');
}

/** True when every error is one the pipeline owns: a syntax error or an entry-point, option or feature-gate diagnostic. */
function onlyStandingErrors(legacy, files) {
  let syntax = null;
  for (const d of legacy) {
    if (d.severity !== 'error' || pipelineCodes.has(d.code) || isFeatureGateCode(d.code)) continue;
    syntax ??= new Set(files.flatMap(f => f.diagnostics.map(key)));
    if (!syntax.has(key(d))) return false;
  }
  return true;
}

const hasNoEntryPoint = legacy => legacy.some(d => d.code === 'CS5001');

/**
 * @param compilation the Compilation after its pipeline ran  @param {object[]} featureDiagnostics parser-level version gates
 * @returns {null|{diagnostics:object[],semantic:object}} the reconciled diagnostic list, or null when nothing changes
 */
export function reconcileWithSemanticAnalysis(compilation, featureDiagnostics = []) {
  const legacy = compilation.diagnostics,
    files = compilation.inputFiles,
    hasReferences = !!compilation.options.references?.length;
  // The syntax adapter's stand-in errors (an `init` accessor) mark a construct outside the profile like the SF codes do,
  // but they are not diagnostics of the program: they select the analysis and are never reported with its results.
  const outside = legacy.filter(d => isProfileConstructDiagnostic(d.code) || adapterPseudo(d)),
    profile = outside.filter(d => !adapterPseudo(d));
  // The semantic analysis is consulted when the execution pipeline could not compile the program: it names constructs
  // outside the profile, or its string-typed binder rejected something (possibly valid C# it does not understand).
  // A program the pipeline compiles is analysed only for its using directives, and only when one of them looks wrong.
  const compiled = !outside.length && !legacy.some(d => d.severity === 'error');
  if (!files.every(f => f.syntax)) return null;
  // ... and for the language-version gates of features only binding recognises, when a lower version is selected.
  const options = compilation.options,
    versionSelected = options.langVersion !== undefined || options.langVersionByUri !== undefined,
    gatesVersion = versionSelected && files.some(f => compilation.selectedVersion({ uri: f.source.uri }).number < newestLanguageVersion);
  // Errors the pipeline owns (no entry point, options, language-version gates, syntax) stand whatever the analysis
  // would say, so a program that has only those is not analysed at all: this is the common case of a file without Main.
  // Nor is a program without an entry point: nothing can be generated for it, so the pipeline's diagnostics stand.
  const nothingToGenerate = onlyStandingErrors(legacy, files) || hasNoEntryPoint(legacy);
  if (!compiled && !gatesVersion && !outside.length && !hasReferences && nothingToGenerate) return null;
  const usings = compiled && !gatesVersion ? suspiciousUsings(compilation) : null,
    // ... and for the few language rules the pipeline does not check on constructs it compiles.
    rechecked = compiled && needsSemanticRules(files);
  if (compiled && !gatesVersion && !usings && !rechecked) return null;
  let result;
  try {
    const analysis = new SemanticAnalysis(files, {
      ...compilation.options,
      nullableContext: compilation.typedOptions?.nullableContext ?? compilation.options.nullableContext,
    });
    // Wrong using directives of a program that compiles are diagnosed from the directives alone.
    result = usings === 'directives' && !rechecked ? analysis.runUsings() : analysis.run();
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
    result.assembly.types.some(t => t.getMembers('Main').some(m => m.kind === SymbolKind.Method && isEntryPointCandidate(m)));
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
  const { isUsingDiagnostic, isNamespaceDiagnostic } = usingDiagnosticClassifier(files);
  // "Feature is not available" diagnostics of the binder are reported whatever else is decided, unless the pipeline
  // already reports the same code on the same construct.
  const overlaps = (a, b) => a.uri === b.uri && a.code === b.code && a.start < b.start + b.length && b.start < a.start + a.length;
  const featureGates = semantic.filter(d => featureDiagnosticCodes.has(d.code) && !legacy.some(l => overlaps(l, d)));
  const unchanged = () => (featureGates.length ? { diagnostics: merge(legacy, featureGates), semantic: result } : null);
  if (compiled) {
    // The image stands; the analysis only adds what it found in the using directives and alias declarations.
    const taken = d => isUsingDiagnostic(d) || d.code === 'CS0576' || (rechecked && semanticRuleCodes.has(d.code));
    const extra = [...semantic.filter(taken), ...featureGates];
    return extra.length ? { diagnostics: merge(legacy, extra), semantic: result } : null;
  }
  if (errors.length) {
    // Both binders reject the program: without profile constructs (or references) the pipeline's diagnostics stand,
    // unless the analysis found a namespace or alias error - the string-typed binder does not know those rules.
    // ... or the program has async functions: the pipeline binds those after a source-level rewrite into a kickoff and
    // a body, which moves and renames what its binder reports.
    const rewritten = compilation.methods.some(m => m.node?.asyncRole) || legacy.some(d => asyncRewriteCodes.has(d.code));
    if (result.incomplete && !outside.length && !hasReferences && !rewritten && !errors.some(isNamespaceDiagnostic)) return unchanged();
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
  if (result.incomplete) return unchanged();
  // Valid C#. Diagnostics the pipeline owns (syntax, entry point, options, language-version gates) stand whatever the
  // analysis says; if one of them is an error there is nothing to generate.
  const standing = legacy.filter(d => (owned(d) && !(d.code === 'CS5001' && hasEntry)) || isFeatureGateCode(d.code)),
    blocked = standing.some(d => d.severity === 'error');
  if (!profile.length && blocked) {
    // Only a stand-in error named a construct outside the profile: the standing errors are the whole story.
    return outside.length ? { diagnostics: merge(standing, semantic), semantic: result } : unchanged();
  }
  // Outside the execution profile: generate code from the semantic bound trees (codegen/semantic). What the profile's
  // own binder said about the constructs it does not know no longer applies.
  const generated = blocked ? null : generateFromSemanticAnalysis(result, files, compilation.options);
  if (generated?.image) return { diagnostics: merge(standing, semantic), semantic: result, image: generated.image };
  // Valid C# that needs a runtime capability the profile lacks: one SF2200 naming the construct, no image.
  const names = [...new Set(profile.map(d => constructNames[d.code] ?? d.code))],
    construct = generated?.unsupported.construct ?? names.join('; '),
    where = generated?.unsupported.syntax ?? null,
    first = profile[0] ?? legacy.find(d => d.severity === 'error'),
    span = where?.span ?? where,
    at =
      span?.start !== undefined
        ? { uri: generated.unsupported.uri ?? first?.uri, start: span.start, length: Math.max(1, span.end - span.start) }
        : first,
    source = compilation.sources.get(at?.uri) ?? compilation.sources.get(first?.uri) ?? compilation.files[0]?.source;
  const diagnostics = merge([...standing, ...profile], semantic);
  if (at && source) diagnostics.push(diagnostic(source, at.start, at.length, 'SF2200', formatMessage('SF2200', [construct]), 'error'));
  return { diagnostics, semantic: result };
}
