import {roslynCodes,ROSLYN_VERSION} from './roslyn-codes.js';
export {ROSLYN_VERSION} from './roslyn-codes.js';
/**
 * The compiler diagnostic catalog.
 *
 * CSxxxx descriptors (name, severity, warning level, message format) come verbatim from the pinned Roslyn
 * resource dump (packages/compiler/test/roslyn/diagnostic-messages.json) through the generated roslyn-codes.js.
 * SF2xxx/SF3xxx are SharpForge codes: each one either names the Roslyn code it stands in for (`roslyn`) or is
 * marked as a profile restriction - a construct Roslyn accepts that this execution profile does not implement.
 * Compiler modules pass a code plus an argument array; no module supplies message text of its own.
 */
const profile=(format,roslyn=null,extra={})=>Object.freeze({severity:'error',warningLevel:0,format,roslyn,profileRestriction:roslyn===null,...extra});
export const profileCodes=Object.freeze({
  SF2001:profile('readonly and const fields are not supported by this profile'),
  SF2002:profile('Only catch (Exception) and catch-all clauses are supported by this profile'),
  SF2003:profile('char values are not supported by this execution profile'),
  SF2004:profile('Integer literals above Int32.MaxValue are not supported by this profile'),
  SF2005:profile("Cannot apply indexing with [] to an expression of type '{0}'",'CS0021'),
  SF2006:profile("Operator '{0}' is not implemented by this profile"),
  SF2008:profile("Invalid target type '{0}': this profile produces 'exe' or 'library'",'CS2019'),
  SF2009:profile("Invalid option '{0}'; overflow-check options must be boolean",'CS2007'),
  SF2010:profile("The 'partial' modifier is supported on classes only in this profile"),
  SF2014:profile("Static constructors are not supported by this profile"),
  SF2011:profile("Same-named types '{0}' in different namespaces cannot be represented by this back end",null,{retired:true}),
  SF2013:profile('Collection initializers require a registered collection Add contract in this profile'),
  SF2098:profile("Expression '{0}' is not implemented by this profile"),
  SF2099:profile("Statement '{0}' is not implemented by this profile"),
  SF2140:profile("Invalid option '{0}' for /langversion. Supported values are 1-14, default, latest and preview",'CS1617'),
  SF2141:profile('Null-conditional access is supported as an assignment statement only in this profile'),
  SF2142:profile('Labeled break and continue require a directly labeled loop or switch'),
  SF2143:profile('The supported with(...) form supplies one capacity argument to List<T> or HashSet<T>'),
  SF2200:profile('The program is valid C# but is not executable on this runtime profile: it uses {0}'),
  SF2201:profile('Semantic analysis failed internally ({0}); only the profile diagnostics are reported'),
  SF2202:profile("The preview feature '{0}' is parsed and gated but not bound yet (provisional: {1})"),
  SF2203:profile('Preview rule: {0} (provisional: {1})'),
  SF3001:profile('CIL emission failed: {0}')
});
/** Number of distinct `{n}` placeholders a message format consumes. */
export function argumentCount(format){let max=-1;for(const m of format.matchAll(/\{(\d+)(?:[,:][^}]*)?\}/g))max=Math.max(max,Number(m[1]));return max+1;}
const cache=new Map();
/** Descriptor for a diagnostic id, or null when the id is not in the catalog. */
export function diagnosticDescriptor(code){
  if(cache.has(code))return cache.get(code);let result=null;
  if(Object.hasOwn(roslynCodes,code)){const [name,severity,warningLevel,format]=roslynCodes[code];result=Object.freeze({id:code,name,severity,warningLevel,format,argumentCount:argumentCount(format),roslyn:code,profileRestriction:false});}
  else if(Object.hasOwn(profileCodes,code)){const p=profileCodes[code];result=Object.freeze({id:code,name:code,...p,argumentCount:argumentCount(p.format)});}
  cache.set(code,result);return result;
}
export const hasDiagnosticCode=code=>diagnosticDescriptor(code)!==null;
/** All catalog ids: the Roslyn codes followed by the SharpForge profile codes. */
export const diagnosticCodes=()=>[...Object.keys(roslynCodes),...Object.keys(profileCodes)];
/**
 * Identifier constants for compiler callers, derived from the existing descriptor catalogs.
 * The extra SF1xxx ids belong to the parser and are only inspected by the compiler;
 * their messages stay with the parser and are not compiler message descriptors.
 * A null prototype prevents unknown ids from resolving to inherited object members.
 */
export const DiagnosticId = Object.freeze(Object.assign(
  Object.create(null),
  Object.fromEntries([
    ...diagnosticCodes(),
    'SF1003', 'SF1004', 'SF1005', 'SF1010', 'SF1011', 'SF1012',
    'SF1013', 'SF1014', 'SF1015', 'SF1017', 'SF1018', 'SF1019'
  ].map(id => [id, id]))
));
/** Formats a catalog message. Unknown ids are a compiler bug and throw; a missing argument renders as an empty string. */
export function formatMessage(code,args=[]){
  const d=diagnosticDescriptor(code);if(!d)throw new RangeError(`Diagnostic '${code}' is not in the compiler catalog`);
  return d.format.replace(/\{(\d+)(?:[,:][^}]*)?\}/g,(_,i)=>String(args[Number(i)]??''));
}
/** Roslyn severities are error|warning|info|hidden; the SharpForge diagnostic model uses error|warning|information|hint. */
export function defaultSeverity(code){const s=diagnosticDescriptor(code)?.severity??'error';return s==='info'?'information':s==='hidden'?'hint':s;}
/** The Roslyn id a SharpForge code stands in for, the id itself for CS codes, or null for profile restrictions. */
export const roslynEquivalent=code=>diagnosticDescriptor(code)?.roslyn??null;
/** Roslyn "feature not available" ids are per selected language version (CS8059 for C# 6 ... CS9058 for C# 11). */
const featureCodes=Object.freeze({1:'CS8022',2:'CS8023',3:'CS8024',4:'CS8025',5:'CS8026',6:'CS8059',7:'CS8107',7.1:'CS8302',7.2:'CS8320',7.3:'CS8370',8:'CS8400',9:'CS8773',10:'CS8936',11:'CS9058',12:'CS9202',13:'CS9260',14:'CS9327'});
export function featureNotAvailableCode(selectedVersion){return featureCodes[selectedVersion]??'CS9058';}
const featureGateCodes=new Set([...Object.values(featureCodes),'CS8652']);
/** True for a "feature not available in C# N" (or preview-only) diagnostic id. */
export function isFeatureGateCode(code){return featureGateCodes.has(code);}
