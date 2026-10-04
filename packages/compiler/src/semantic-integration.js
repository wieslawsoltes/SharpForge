/**
 * Reconciles the execution pipeline with semantic analysis and lowering (SF-A02-E01/E02).
 * Programs outside the direct execution profile can be generated from semantic bound trees. Invalid programs retain
 * C# diagnostics, and unsupported runtime constructs report SF2200 without an image. Explicit metadata references
 * are always analysed, including when unused, so invalid metadata and reference binding errors cannot pass silently.
 * Programs already emitted retain their image; using and feature diagnostics are added where analysis requires them.
 */
import {DiagnosticId} from './diagnostics/codes.js';
import { diagnostic } from '@sharpforge/text';
import { SemanticAnalysis } from './semantic-analysis.js';
import { SymbolKind } from './symbols/types.js';
import { formatMessage, isFeatureGateCode } from './diagnostics/codes.js';
import { suspiciousUsings, usingDiagnosticClassifier } from './binder/using-check.js';
import { featureDiagnosticCodes, newestLanguageVersion } from './binder/feature-check.js';
import { generateFromSemanticAnalysis, isEntryPointCandidate } from './codegen/semantic/generator.js';
import { applicableRuleCodes } from './semantic/profile-rechecks.js';

/** Profile diagnostics that mark a construct the execution profile cannot run (as opposed to option and API errors). */
export const isProfileConstructDiagnostic = code =>
  /^SF1\d{3}$/.test(code) || /^SF20(0[1-7]|1[0-4]|9[89])$/.test(code) || /^SF214[1-3]$/.test(code);
/** Diagnostics the legacy pipeline owns whatever the semantic analysis says: entry point, options, CIL. */
const pipelineCodes = new Set([
  DiagnosticId.CS5001,
  DiagnosticId.CS0017,
  DiagnosticId.CS0028,
  DiagnosticId.CS7022,
  DiagnosticId.CS8892,
  DiagnosticId.CS1555,
  DiagnosticId.CS1558,
  DiagnosticId.CS4009,
  DiagnosticId.CS9273,
  DiagnosticId.CS8803,
  DiagnosticId.CS1617,
  DiagnosticId.CS2019,
  DiagnosticId.CS8630,
  DiagnosticId.CS8636,
  DiagnosticId.CS1900,
  DiagnosticId.CS2029,
  DiagnosticId.CS2017,
  DiagnosticId.CS8203,
  DiagnosticId.CS7088,
  DiagnosticId.CS2007,
  DiagnosticId.SF2008,
  DiagnosticId.SF2009,
  DiagnosticId.SF2140,
  DiagnosticId.SF3001,
]);
/** What the pipeline's source-level async rewrite reports when it meets `await` or `async` it cannot rewrite. */
const asyncRewriteCodes = new Set([DiagnosticId.CS4032, DiagnosticId.CS1983]);
const adapterPseudo = d =>
  (d.code === DiagnosticId.CS1014 && /init is not supported/.test(d.message)) || (d.code === DiagnosticId.CS0528 && /Duplicate IDisposable/.test(d.message));
const constructNames = {
  [DiagnosticId.SF1003]: '64-bit and unsigned integer literals',
  [DiagnosticId.SF1004]: 'integer literals outside Int32',
  [DiagnosticId.SF1005]: 'float and decimal literals',
  [DiagnosticId.SF1010]: 'struct, interface, enum, delegate and record declarations',
  [DiagnosticId.SF1011]: 'virtual, abstract, override and other member modifiers',
  [DiagnosticId.SF1012]: 'user-defined generics',
  [DiagnosticId.SF1013]: 'nullable types',
  [DiagnosticId.SF1014]: 'base classes and interfaces',
  [DiagnosticId.SF1015]: 'nested types',
  [DiagnosticId.SF1017]: 'ref, out, in and named arguments',
  [DiagnosticId.SF1018]: 'declaration forms outside the profile',
  [DiagnosticId.SF1019]: 'multi-dimensional arrays and type forms outside the profile',
  [DiagnosticId.SF2001]: 'const and readonly fields',
  [DiagnosticId.SF2014]: 'static constructors',
  [DiagnosticId.SF2002]: 'typed exception handlers',
  [DiagnosticId.SF2003]: 'char values',
  [DiagnosticId.SF2004]: 'integers outside Int32',
  [DiagnosticId.SF2005]: 'indexers',
  [DiagnosticId.SF2006]: 'casts across class hierarchies',
  [DiagnosticId.SF2098]: 'expressions outside the profile',
  [DiagnosticId.SF2099]: 'statements outside the profile',
  [DiagnosticId.SF2141]: 'null-conditional access as a value',
};
const key = d => d.code + '|' + d.uri + '|' + d.start + '|' + d.length + '|' + d.message;

function internalFailure(compilation, error) {
  const source = compilation.files[0]?.source;
  const reason = String(error?.message ?? error).split('\n')[0];
  return diagnostic(source, 0, 1, DiagnosticId.SF2201, formatMessage(DiagnosticId.SF2201, [reason]), 'warning');
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

const hasNoEntryPoint = legacy => legacy.some(d => d.code === DiagnosticId.CS5001);

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
  const usings = compiled && !gatesVersion && !hasReferences ? suspiciousUsings(compilation) : null,
    // ... and for the few language rules the pipeline does not check on constructs it compiles.
    nullableContext = compilation.typedOptions?.nullableContext ?? compilation.options.nullableContext ?? compilation.options.nullable,
    ruleCodes = compiled ? applicableRuleCodes(files, { nullableContext }) : null,
    rechecked = !!ruleCodes?.size;
  if (compiled && !gatesVersion && !hasReferences && !usings && !rechecked) return null;
  let result;
  try {
    const analysis = new SemanticAnalysis(files, {
      ...compilation.options,
      // Retain the execution profile's builtin receiver shorthands when semantic lowering takes over.
      // Explicit using policy or metadata references keep ordinary C# name resolution.
      executionBuiltinAliases: !compiled && !hasReferences && options.implicitUsings === undefined,
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
  const owned = d => syntax.has(key(d)) || features.has(key(d)) || (pipelineCodes.has(d.code) && !(d.code === DiagnosticId.CS5001 && hasEntry));
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
  if (compiled && (!hasReferences || !errors.length)) {
    // The image stands; the analysis only adds what it found in the using directives and alias declarations.
    const taken = d => isUsingDiagnostic(d) || d.code === DiagnosticId.CS0576 || (rechecked && ruleCodes.has(d.code));
    const extra = [...semantic.filter(taken), ...featureGates];
    if (!extra.length) return null;
    if (!extra.some(d => d.severity === 'error')) return { diagnostics: merge(legacy, extra), semantic: result };
    // A rule of the analysis rejects the program: its warnings describe the program too (the pipeline bound it wrongly,
    // so what it found unused or unreachable need not be).
    const standing = legacy.filter(d => d.severity !== 'warning' || owned(d)),
      warnings = result.incomplete ? [] : semantic.filter(d => d.severity === 'warning');
    return { diagnostics: merge(standing, [...extra, ...warnings]), semantic: result };
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
    const literalCodes = new Set([DiagnosticId.SF1003, DiagnosticId.SF1004, DiagnosticId.SF1005, DiagnosticId.SF2004]);
    const keptProfile = profile.filter(p => !(literalCodes.has(p.code) && errors.some(e => e.uri === p.uri && e.start === p.start)));
    return {
      diagnostics: merge([...legacy.filter(owned), ...keptProfile], semantic).sort((a, b) => (a.uri === b.uri ? a.start - b.start : 0)),
      semantic: result,
    };
  }
  if (result.incomplete) return unchanged();
  // Valid C#. Diagnostics the pipeline owns (syntax, entry point, options, language-version gates) stand whatever the
  // analysis says; if one of them is an error there is nothing to generate.
  const standing = legacy.filter(d => (owned(d) && !(d.code === DiagnosticId.CS5001 && hasEntry)) || isFeatureGateCode(d.code)),
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
    construct = generated?.unsupported.construct ?? (names.join('; ') || 'referenced types or members outside the execution profile'),
    where = generated?.unsupported.syntax ?? null,
    first = profile[0] ?? legacy.find(d => d.severity === 'error'),
    span = where?.span ?? where,
    at =
      span?.start !== undefined
        ? { uri: generated.unsupported.uri ?? first?.uri, start: span.start, length: Math.max(1, span.end - span.start) }
        : first,
    source = compilation.sources.get(at?.uri) ?? compilation.sources.get(first?.uri) ?? compilation.files[0]?.source;
  const diagnostics = merge([...standing, ...profile], semantic);
  if (at && source) diagnostics.push(diagnostic(source, at.start, at.length, DiagnosticId.SF2200, formatMessage(DiagnosticId.SF2200, [construct]), 'error'));
  return { diagnostics, semantic: result };
}
