/**
 * Typed compilation options (SF-A02-T38).
 *
 * `CompilationOptions` is the immutable, validated form of everything the compiler is configured with;
 * `parseCompilationOptions(raw)` builds it from the loose option bag callers pass today (`compile(source,{...})`) and
 * `fromMSBuildProperties(props)` from MSBuild property names. Both return `{options,diagnostics:[{code,args}]}`:
 * an invalid value is reported with the Roslyn code csc uses and replaced by the default, so `options` is always usable.
 *   CS2019 invalid /target            CS1617 invalid /langversion        CS8636 invalid /nullable
 *   CS8630 nullable needs C# 8        CS1900 negative warning level      CS2029 bad /define symbol (warning)
 *   CS2017 /main with a library       CS8203 invalid assembly name       CS7088 invalid option value (API)
 *   CS2007 unrecognized switch value (MSBuild booleans)
 * Two SharpForge codes remain: SF2009 when `checkOverflow` is not a boolean in the JavaScript API, and - with
 * `profile:true`, the default - SF2008 for output kinds other than exe/library.
 * Language spellings and feature selection use the shared syntax language-version table.
 */
import {DiagnosticId} from './diagnostics/codes.js';
import {parseLanguageVersion as syntaxLanguageVersion,displayLanguageVersion} from '@sharpforge/syntax';
import {normalizeDiagnosticId} from './diagnostics/suppression.js';

/** Roslyn output kinds by /target name. */
export const outputKinds=Object.freeze(['exe','winexe','library','module','appcontainerexe','winmdobj']);
/** Output kinds this execution profile can emit. */
export const profileOutputKinds=Object.freeze(['exe','library']);
export const nullableContexts=Object.freeze(['disable','enable','warnings','annotations']);
export const optimizationLevels=Object.freeze(['debug','release']);
const msbuildOutputTypes=Object.freeze({exe:'Exe',winexe:'WinExe',library:'Library',module:'Module',appcontainerexe:'AppContainerExe',winmdobj:'WinMDObj'});

/**
 * Parses a /langversion value the way Roslyn does (case-insensitive): 1-14 with an optional `.0`, 7.1, 7.2, 7.3,
 * iso-1, iso-2, default, latest, latestmajor and preview. Returns `{name,number,preview,display}` (`number` is 15 for
 * preview, 14 for default/latest) or null when the value is not a language version.
 */
export function parseLanguageVersion(value){
  const parsed=syntaxLanguageVersion(value??'');
  return parsed?{...parsed,display:displayLanguageVersion(parsed.number)}:null;
}

const FIELDS=Object.freeze(['name','outputKind','checkOverflow','checkOverflowByUri','allowUnsafe','nullableContext','optimizationLevel','deterministic','preprocessorSymbols','mainTypeName','langVersion','langVersionByUri','warningLevel','noWarn','warnAsError','warnNotAsError','treatWarningsAsErrors']);
const freezeList=list=>Object.freeze([...list]);
const freezeMap=map=>map?Object.freeze(Object.assign(Object.create(null),map)):null;

/**
 * Immutable compilation options. Construct with `parseCompilationOptions` / `fromMSBuildProperties`, or
 * `CompilationOptions.default`; derive variants with `with()`.
 *   name                 assembly name or null (the compiler's default applies)
 *   outputKind           'exe' | 'winexe' | 'library' | 'module' | 'appcontainerexe' | 'winmdobj'
 *   checkOverflow        default overflow checking of non-constant arithmetic; checkOverflowByUri overrides per file
 *   allowUnsafe          /unsafe
 *   nullableContext      'disable' | 'enable' | 'warnings' | 'annotations'
 *   optimizationLevel    'debug' | 'release'
 *   deterministic        /deterministic
 *   preprocessorSymbols  frozen array of defined symbols
 *   mainTypeName         /main type name or null
 *   langVersion          lower-case /langversion text or null (compiler default); langVersionByUri overrides per file
 *   warningLevel         0 or greater (default 4)
 *   noWarn, warnAsError, warnNotAsError   frozen arrays of normalised diagnostic ids (CS0168, ...)
 *   treatWarningsAsErrors
 * The object is directly usable as `settings.options` of diagnostics/suppression.js `applySuppression`.
 */
export class CompilationOptions{
  constructor(fields={}){
    const f={...defaults,...fields};
    for(const key of FIELDS)this[key]=f[key];
    this.preprocessorSymbols=freezeList(this.preprocessorSymbols);this.noWarn=freezeList(this.noWarn);this.warnAsError=freezeList(this.warnAsError);this.warnNotAsError=freezeList(this.warnNotAsError);
    this.checkOverflowByUri=freezeMap(this.checkOverflowByUri);this.langVersionByUri=freezeMap(this.langVersionByUri);
    Object.freeze(this);
  }
  static get default(){return defaultOptions;}
  /**
   * A copy with the given raw option values changed (same value forms as `parseCompilationOptions`).
   * Throws RangeError naming the diagnostic codes when a change is invalid; use `parseCompilationOptions` to get diagnostics instead.
   */
  with(changes={}){
    const {options,diagnostics}=parseCompilationOptions({...this.toJSON(),...changes});
    const errors=diagnostics.filter(d=>d.code!==DiagnosticId.CS2029);
    if(errors.length)throw new RangeError('Invalid compilation options: '+errors.map(d=>d.code).join(', '));
    return options;
  }
  /** Plain raw option bag; `parseCompilationOptions(options.toJSON())` yields equal options. */
  toJSON(){
    const out={};
    for(const key of FIELDS){const v=this[key];if(v===null)continue;out[key]=Array.isArray(v)?[...v]:typeof v==='object'?{...v}:v;}
    return out;
  }
  equals(other){return other instanceof CompilationOptions&&JSON.stringify(this.toJSON())===JSON.stringify(other.toJSON());}
  /** True for output kinds without an entry point (library, module, winmdobj). */
  get isLibrary(){return ['library','module','winmdobj'].includes(this.outputKind);}
  /** Overflow checking default for a file. */
  checkOverflowFor(uri){return this.checkOverflowByUri?.[uri]??this.checkOverflow;}
  /** The /langversion text selected for a file, or null for the compiler default. */
  langVersionFor(uri){return this.langVersionByUri?.[uri]??this.langVersion;}
  /** True when `symbol` is a defined preprocessor symbol. */
  isDefined(symbol){return this.preprocessorSymbols.includes(symbol);}
}
const defaults=Object.freeze({name:null,outputKind:'exe',checkOverflow:false,checkOverflowByUri:null,allowUnsafe:false,nullableContext:'disable',optimizationLevel:'debug',deterministic:false,preprocessorSymbols:Object.freeze([]),mainTypeName:null,langVersion:null,langVersionByUri:null,warningLevel:4,noWarn:Object.freeze([]),warnAsError:Object.freeze([]),warnNotAsError:Object.freeze([]),treatWarningsAsErrors:false});
const defaultOptions=new CompilationOptions();

const isIdentifier=text=>/^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\p{Cf}]*$/u.test(text);
const splitList=value=>(Array.isArray(value)?value.map(String):String(value).split(/[;,]/)).map(s=>s.trim()).filter(Boolean);
const unique=list=>[...new Set(list)];
const isPlainObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

/**
 * Validates a raw option bag and returns `{options,diagnostics}`.
 * Accepted keys: name, outputKind, checkOverflow, checkOverflowByUri, allowUnsafe, nullableContext (alias nullable),
 * optimizationLevel (alias optimize:boolean), deterministic, preprocessorSymbols (array or `;`/`,` separated string),
 * mainTypeName, langVersion, langVersionByUri, warningLevel, noWarn / warnAsError / warnNotAsError (arrays or
 * separated strings of ids or numbers; `warnAsError:true` means all), treatWarningsAsErrors. Unknown keys are ignored
 * (the caller keeps its own bag for them); undefined/null values select the default. A `CompilationOptions` is returned unchanged.
 * @param {object} [raw] @param {{profile?:boolean}} [settings] `profile:false` validates against Roslyn only
 * @returns {{options:CompilationOptions,diagnostics:{code:string,args:any[]}[]}}
 */
export function parseCompilationOptions(raw={},{profile=true}={}){
  if(raw instanceof CompilationOptions)return {options:raw,diagnostics:[]};
  const diagnostics=[],fields={},report=(code,args=[])=>{diagnostics.push({code,args});};
  const given=key=>raw?.[key]!==undefined&&raw[key]!==null;
  const boolean=(key,optionName)=>{if(!given(key))return;if(typeof raw[key]==='boolean')fields[key]=raw[key];else report(DiagnosticId.CS7088,[optionName,String(raw[key])]);};

  if(given('name')){const name=raw.name;if(typeof name==='string'&&name.length>0&&!/^\s|[\\/:*?"<>|\u0000-\u001f]/.test(name))fields.name=name;else report(DiagnosticId.CS8203,[String(name)]);}
  if(given('outputKind')){
    const kind=raw.outputKind;
    if(typeof kind!=='string'||!outputKinds.includes(kind))report(DiagnosticId.CS2019);
    else if(profile&&!profileOutputKinds.includes(kind))report(DiagnosticId.SF2008,[kind]);
    else fields.outputKind=kind;
  }
  // The JavaScript API takes real booleans here; SF2009 is the existing code for that typing error.
  if(given('checkOverflow')||raw.checkOverflow===null){if(typeof raw.checkOverflow==='boolean')fields.checkOverflow=raw.checkOverflow;else report(DiagnosticId.SF2009,['checkOverflow']);}
  if(given('checkOverflowByUri')){if(isPlainObject(raw.checkOverflowByUri)&&Object.values(raw.checkOverflowByUri).every(v=>typeof v==='boolean'))fields.checkOverflowByUri={...raw.checkOverflowByUri};else if(!diagnostics.some(d=>d.code===DiagnosticId.SF2009))report(DiagnosticId.SF2009,['checkOverflow']);}
  boolean('allowUnsafe','AllowUnsafe');boolean('deterministic','Deterministic');boolean('treatWarningsAsErrors','TreatWarningsAsErrors');

  const language=(value)=>{
    const parsed=parseLanguageVersion(value);
    if(!parsed||typeof value!=='string'&&typeof value!=='number'){report(DiagnosticId.CS1617,[String(value)]);return null;}
    return parsed;
  };
  let selected=null;
  if(given('langVersion')){selected=language(raw.langVersion);if(selected)fields.langVersion=selected.name;}
  if(given('langVersionByUri')){
    if(!isPlainObject(raw.langVersionByUri))report(DiagnosticId.CS1617,[String(raw.langVersionByUri)]);
    else{const map={};for(const [uri,value] of Object.entries(raw.langVersionByUri)){const parsed=language(value);if(parsed)map[uri]=parsed.name;}fields.langVersionByUri=map;}
  }
  const nullable=given('nullableContext')?raw.nullableContext:given('nullable')?raw.nullable:undefined;
  if(nullable!==undefined){
    const value=String(nullable).trim().toLowerCase();
    if(typeof nullable!=='string'||!nullableContexts.includes(value))report(DiagnosticId.CS8636,[String(nullable)]);
    else if(value!=='disable'&&selected&&selected.number<8)report(DiagnosticId.CS8630,['nullable',value[0].toUpperCase()+value.slice(1),selected.display,'8.0']);
    else fields.nullableContext=value;
  }
  if(given('optimizationLevel')){const value=String(raw.optimizationLevel).trim().toLowerCase();if(typeof raw.optimizationLevel==='string'&&optimizationLevels.includes(value))fields.optimizationLevel=value;else report(DiagnosticId.CS7088,['OptimizationLevel',String(raw.optimizationLevel)]);}
  else if(given('optimize')){if(typeof raw.optimize==='boolean')fields.optimizationLevel=raw.optimize?'release':'debug';else report(DiagnosticId.CS7088,['OptimizationLevel',String(raw.optimize)]);}
  if(given('preprocessorSymbols')){
    const symbols=[];
    for(const symbol of splitList(raw.preprocessorSymbols)){if(isIdentifier(symbol))symbols.push(symbol);else report(DiagnosticId.CS2029,[symbol]);}
    fields.preprocessorSymbols=unique(symbols);
  }
  if(given('warningLevel')){
    const level=typeof raw.warningLevel==='string'&&/^\s*[+-]?\d+\s*$/.test(raw.warningLevel)?Number(raw.warningLevel):raw.warningLevel;
    if(Number.isInteger(level)&&level>=0)fields.warningLevel=level;else report(DiagnosticId.CS1900);
  }
  for(const key of ['noWarn','warnAsError','warnNotAsError']){
    if(!given(key))continue;
    if(key==='warnAsError'&&typeof raw[key]==='boolean'){if(raw[key])fields.treatWarningsAsErrors=true;continue;}
    fields[key]=unique(splitList(raw[key]).map(normalizeDiagnosticId));
  }
  if(given('mainTypeName')){
    const main=raw.mainTypeName,kind=fields.outputKind??'exe';
    if(typeof main!=='string'||!main.trim())report(DiagnosticId.CS7088,['MainTypeName',String(main)]);
    else if(['library','module','winmdobj'].includes(kind))report(DiagnosticId.CS2017);
    else fields.mainTypeName=main.trim();
  }
  return {options:new CompilationOptions(fields),diagnostics};
}

const msbuildNames=Object.freeze(['OutputType','CheckForOverflowUnderflow','AllowUnsafeBlocks','Nullable','Optimize','Deterministic','DefineConstants','StartupObject','LangVersion','WarningLevel','NoWarn','WarningsAsErrors','WarningsNotAsErrors','TreatWarningsAsErrors','AssemblyName']);
/** The MSBuild property names `fromMSBuildProperties` reads and `toMSBuildProperties` writes. */
export const msbuildPropertyNames=msbuildNames;
/**
 * Builds options from evaluated MSBuild properties (names matched case-insensitively, empty values are unset):
 * OutputType, CheckForOverflowUnderflow, AllowUnsafeBlocks, Nullable, Optimize, Deterministic, DefineConstants,
 * StartupObject, LangVersion, WarningLevel, NoWarn, WarningsAsErrors, WarningsNotAsErrors, TreatWarningsAsErrors,
 * AssemblyName. A boolean property that is neither true nor false reports CS2007 with the csc switch it maps to.
 * @returns {{options:CompilationOptions,diagnostics:{code:string,args:any[]}[]}}
 */
export function fromMSBuildProperties(properties={},settings={}){
  const lower=new Map(Object.entries(properties??{}).map(([k,v])=>[k.toLowerCase(),v]));
  const get=name=>{const v=lower.get(name.toLowerCase());if(v===undefined||v===null)return undefined;const text=String(v).trim();return text===''?undefined:text;};
  const raw={},early=[];
  const boolean=(name,key,flag)=>{const v=get(name);if(v===undefined)return;const t=v.toLowerCase();if(t==='true'||t==='false')raw[key]=t==='true';else early.push({code:DiagnosticId.CS2007,args:[`/${flag}:${v}`]});};
  const output=get('OutputType');if(output!==undefined)raw.outputKind=output.toLowerCase();
  boolean('CheckForOverflowUnderflow','checkOverflow','checked');boolean('AllowUnsafeBlocks','allowUnsafe','unsafe');boolean('Optimize','optimize','optimize');
  boolean('Deterministic','deterministic','deterministic');boolean('TreatWarningsAsErrors','treatWarningsAsErrors','warnaserror');
  const copy=(name,key)=>{const v=get(name);if(v!==undefined)raw[key]=v;};
  copy('Nullable','nullableContext');copy('DefineConstants','preprocessorSymbols');copy('StartupObject','mainTypeName');copy('LangVersion','langVersion');
  copy('WarningLevel','warningLevel');copy('NoWarn','noWarn');copy('WarningsAsErrors','warnAsError');copy('WarningsNotAsErrors','warnNotAsError');copy('AssemblyName','name');
  const {options,diagnostics}=parseCompilationOptions(raw,settings);
  return {options,diagnostics:[...early,...diagnostics]};
}
/**
 * The MSBuild properties equivalent to `options` (string values, canonical property names). Unset optional values
 * (AssemblyName, StartupObject, LangVersion) are omitted; the per-file maps have no MSBuild form.
 * `fromMSBuildProperties(toMSBuildProperties(o)).options` equals `o` for options without per-file maps.
 */
export function toMSBuildProperties(options){
  const o=options instanceof CompilationOptions?options:parseCompilationOptions(options).options,p={};
  if(o.name!==null)p.AssemblyName=o.name;
  p.OutputType=msbuildOutputTypes[o.outputKind];
  p.CheckForOverflowUnderflow=String(o.checkOverflow);p.AllowUnsafeBlocks=String(o.allowUnsafe);p.Nullable=o.nullableContext;
  p.Optimize=String(o.optimizationLevel==='release');p.Deterministic=String(o.deterministic);p.DefineConstants=o.preprocessorSymbols.join(';');
  if(o.mainTypeName!==null)p.StartupObject=o.mainTypeName;
  if(o.langVersion!==null)p.LangVersion=o.langVersion;
  p.WarningLevel=String(o.warningLevel);p.NoWarn=o.noWarn.join(';');p.WarningsAsErrors=o.warnAsError.join(';');p.WarningsNotAsErrors=o.warnNotAsError.join(';');
  p.TreatWarningsAsErrors=String(o.treatWarningsAsErrors);
  return p;
}
