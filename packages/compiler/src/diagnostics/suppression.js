/**
 * Warning suppression and severity options (SF-A02-T37): the last step between the diagnostics the compiler produced
 * and the list it reports. Mirrors Roslyn's diagnostic filter and is pinned against it by
 * tests/compiler-suppression.test.js (packages/compiler/test/suppression/roslyn-suppression.json):
 *   1. errors are never touched;
 *   2. a warning above the selected warning level is dropped;
 *   3. /nowarn ids are dropped; /warnaserror ids become errors; /warnaserror- ids are exempt from TreatWarningsAsErrors;
 *   4. `#pragma warning disable|restore [ids]` state at the diagnostic's position drops it (this wins over warnaserror);
 *   5. SuppressMessage-style suppressions drop non-compiler diagnostics (Roslyn never applies them to CSxxxx ids);
 *   6. TreatWarningsAsErrors promotes the remaining warnings (not information/hint) to errors.
 * `#pragma` directives are read straight from the source text because the lexer does not expose directives; the scan
 * skips comments, string/char literals and inactive `#if` regions. Diagnostics use the packages/text shape
 * `{uri,start,length,code,message,severity,range}`; nothing here writes message text (catalog only).
 */
import {DiagnosticId} from './codes.js';
import {diagnosticDescriptor,formatMessage,hasDiagnosticCode} from './codes.js';

/**
 * Canonical diagnostic id as csc's command line reads /nowarn and /warnaserror: a number, optionally prefixed `CS` in
 * any case, names a compiler warning (168, 0168, cs0168 -> CS0168); anything else is kept verbatim (custom ids are
 * case-sensitive).
 */
export function normalizeDiagnosticId(id){const text=String(id).trim(),m=/^(?:cs)?(\d+)$/i.exec(text);return m?'CS'+String(Number(m[1])).padStart(4,'0'):text;}
const idList=value=>value===undefined||value===null||value===true||value===false?[]:(Array.isArray(value)?value:String(value).split(/[;,]/)).map(v=>String(v).trim()).filter(Boolean).map(normalizeDiagnosticId);

const IDENT=/[\p{L}_][\p{L}\p{N}_]*/yu;
/** Evaluates a `#if`/`#elif` condition over the defined symbols (identifiers, true, false, !, &&, ||, ==, !=, parentheses). */
function evaluateCondition(text,symbols){
  const tokens=text.replace(/\/\/.*$/,'').match(/[\p{L}_][\p{L}\p{N}_]*|&&|\|\||==|!=|[!()]/gu)??[];let i=0;
  const primary=()=>{const t=tokens[i++];if(t==='!')return !primary();if(t==='('){const v=or();i++;return v;}return t==='true'?true:t==='false'||t===undefined?false:symbols.has(t);};
  const equality=()=>{let v=primary();while(tokens[i]==='=='||tokens[i]==='!='){const op=tokens[i++],r=primary();v=op==='=='?v===r:v!==r;}return v;};
  const and=()=>{let v=equality();while(tokens[i]==='&&'){i++;const r=equality();v=v&&r;}return v;};
  const or=()=>{let v=and();while(tokens[i]==='||'){i++;const r=and();v=v||r;}return v;};
  return or();
}
/** Tokens of a directive tail: identifiers, digit runs, string literals, single characters; a `//` comment ends the line. */
function directiveTokens(text,from,end){
  const tokens=[];let i=from;
  while(i<end){
    const ch=text[i];
    if(ch===' '||ch==='\t'){i++;continue;}
    if(ch==='/'&&text[i+1]==='/')break;
    let j=i+1,kind='other';
    IDENT.lastIndex=i;const id=IDENT.exec(text);
    if(id&&id.index===i&&i+id[0].length<=end){kind='identifier';j=i+id[0].length;}
    else if(/\d/.test(ch)){kind='number';while(j<end&&/\d/.test(text[j]))j++;}
    else if(ch==='"'){kind='string';while(j<end&&text[j]!=='"')j++;if(j<end)j++;}
    else if(ch===',')kind='comma';
    tokens.push({kind,text:text.slice(i,j),start:i,end:j});i=j;
  }
  return {tokens,eod:i};
}
/**
 * Scans one source text for `#pragma warning` directives.
 * @param {string} text @param {{preprocessorSymbols?:Iterable<string>}} [options] symbols defined for `#if` evaluation
 * @returns {{directives:{start:number,end:number,action:'disable'|'restore',ids:string[]|null}[],diagnostics:{code:string,args:any[],start:number,length:number}[]}}
 *   `ids` null means every warning; `end` is where the directive takes effect. The diagnostics are Roslyn's directive
 *   warnings: CS1633 (unrecognized #pragma), CS1634 (expected disable or restore), CS1072 (expected identifier or
 *   numeric literal) and CS1696 (single-line comment or end-of-line expected).
 */
export function parsePragmaDirectives(text,{preprocessorSymbols=[]}={}){
  const directives=[],diagnostics=[],symbols=new Set(preprocessorSymbols),stack=[];
  const active=()=>stack.every(s=>s.active);
  const report=(code,token,eod)=>diagnostics.push({code,args:[],start:token?token.start:eod,length:token?token.end-token.start:0});
  const directive=(hash,end)=>{
    const {tokens,eod}=directiveTokens(text,hash+1,end),name=tokens[0]?.text,rest=tokens[1]?text.slice(tokens[1].start,end):'';
    if(name==='if'){const on=active()&&evaluateCondition(rest,symbols);stack.push({active:on,taken:on});return;}
    if(name==='elif'||name==='else'){const s=stack.at(-1);if(!s)return;const outer=stack.slice(0,-1).every(x=>x.active);s.active=outer&&!s.taken&&(name==='else'||evaluateCondition(rest,symbols));s.taken=s.taken||s.active;return;}
    if(name==='endif'){stack.pop();return;}
    if(!active())return;
    if(name==='define'&&tokens[1])symbols.add(tokens[1].text);
    else if(name==='undef'&&tokens[1])symbols.delete(tokens[1].text);
    if(name!=='pragma')return;
    if(tokens[1]?.text==='checksum')return;
    if(tokens[1]?.text!=='warning'){report(DiagnosticId.CS1633,tokens[1],eod);return;}
    const action=tokens[2]?.text;
    if(tokens[2]?.kind!=='identifier'||action!=='disable'&&action!=='restore'){report(DiagnosticId.CS1634,tokens[2],eod);return;}
    const ids=[];let i=3,listed=0,failed=false;
    while(i<tokens.length){
      const t=tokens[i];listed++;
      if(t.kind==='number'){ids.push(normalizeDiagnosticId(t.text));i++;}
      else if(t.kind==='identifier'){ids.push(t.text);i++;}
      else{report(DiagnosticId.CS1072,t,eod);failed=true;}
      if(tokens[i]?.kind!=='comma')break;
      i++;
    }
    if(!failed&&i<tokens.length)report(DiagnosticId.CS1696,tokens[i],eod);
    directives.push({start:hash,end,action,ids:listed===0?null:ids});
  };
  let i=0,lineStart=true;const n=text.length;
  const lineEnd=from=>{let j=from;while(j<n&&text[j]!=='\n'&&text[j]!=='\r')j++;return j;};
  while(i<n){
    const ch=text[i];
    if(ch==='\n'||ch==='\r'){lineStart=true;i++;continue;}
    if(ch===' '||ch==='\t'){i++;continue;}
    if(lineStart&&ch==='#'){const end=lineEnd(i);directive(i,end);i=end;continue;}
    if(!active()){i=lineEnd(i);continue;}// skipped text is not lexed
    lineStart=false;
    if(ch==='/'&&text[i+1]==='/'){i=lineEnd(i);continue;}
    if(ch==='/'&&text[i+1]==='*'){const close=text.indexOf('*/',i+2);i=close<0?n:close+2;continue;}
    if(ch==="'"){i++;while(i<n&&text[i]!=="'"&&text[i]!=='\n'){if(text[i]==='\\')i++;i++;}i++;continue;}
    if(ch==='"'||(ch==='@'||ch==='$')&&/^[@$]{1,2}"|^\$+"""/.test(text.slice(i,i+8))){
      let verbatim=false;while(text[i]==='@'||text[i]==='$'){verbatim=verbatim||text[i]==='@';i++;}
      let quotes=0;while(text[i+quotes]==='"')quotes++;
      if(quotes>=3){const close=text.indexOf('"'.repeat(quotes),i+quotes);i=close<0?n:close+quotes;while(text[i]==='"')i++;continue;}
      i++;
      if(verbatim){while(i<n){if(text[i]==='"'){if(text[i+1]==='"'){i+=2;continue;}break;}i++;}i++;continue;}
      while(i<n&&text[i]!=='"'&&text[i]!=='\n'){if(text[i]==='\\')i++;i++;}
      if(text[i]==='"')i++;
      continue;
    }
    i++;
  }
  return {directives,diagnostics};
}

/**
 * The warning state of one file as a function of position, built from its pragma directives.
 * `stateAt(id,position)` is 'disabled' when a `#pragma warning disable` covering `id` is in effect at `position`,
 * otherwise 'default'. Pragma ids are case-sensitive, as in Roslyn.
 */
export class PragmaWarningMap{
  constructor(directives=[]){
    this.entries=[];let general='default',specific=new Map();
    for(const d of [...directives].sort((a,b)=>a.end-b.end)){
      const state=d.action==='disable'?'disabled':'default';
      if(d.ids===null){general=state;specific=new Map();}
      else{specific=new Map(specific);for(const id of d.ids)specific.set(id,state);}
      this.entries.push({position:d.end,general,specific});
    }
    Object.freeze(this);
  }
  /** Builds the map for a source text. */
  static fromText(text,options){return new PragmaWarningMap(parsePragmaDirectives(text,options).directives);}
  stateAt(id,position){
    let low=0,high=this.entries.length;
    while(low<high){const mid=(low+high)>>>1;if(this.entries[mid].position<=position)low=mid+1;else high=mid;}
    if(low===0)return 'default';
    const entry=this.entries[low-1];return entry.specific.get(id)??entry.general;
  }
}

const textOf=source=>typeof source==='string'?source:source?.text;
/** uri -> text from a Map, an iterable of `{uri,text}` (SourceText) or a plain `{uri:text}` object. */
function sourceTexts(sources){
  const map=new Map();if(!sources)return map;
  if(sources instanceof Map)for(const [uri,source] of sources)map.set(uri,textOf(source));
  else if(typeof sources[Symbol.iterator]==='function')for(const source of sources)map.set(source.uri,source.text);
  else for(const [uri,source] of Object.entries(sources))map.set(uri,textOf(source));
  return map;
}
/**
 * The `#pragma warning` directives of a file, from the directive trivia of its syntax tree:
 * `{start,end,action:'disable'|'restore',ids:string[]|null}` for every active disable/restore/enable directive.
 */
export function pragmaDirectivesFromSyntax(directives=[]){
  const result=[];
  for(const d of directives){const s=d.structure;if(!s||s.isActive===false||s.directive!=='pragma'||s.pragma!=='warning'||!s.action)continue;result.push({start:d.start,end:d.end,action:s.action==='disable'?'disable':'restore',ids:s.codes?.length?s.codes.map(normalizeDiagnosticId):null});}
  return result;
}
/** Line/character of an offset, for the `range` of directive diagnostics. */
function positionAt(text,offset){let line=0,start=0;for(let i=0;i<offset;i++){const ch=text[i];if(ch==='\r'){if(text[i+1]==='\n')i++;line++;start=i+1;}else if(ch==='\n'){line++;start=i+1;}}return {line,character:offset-start};}
const within=(d,span)=>(span.uri===undefined||span.uri===d.uri)&&d.start>=span.start&&d.start+(d.length??0)<=span.end;
const defaultIsCompilerDiagnostic=d=>/^CS\d+$/.test(d.code)||hasDiagnosticCode(d.code);

/**
 * Applies suppression and severity options to a diagnostic list and returns the final list (input order preserved;
 * a promoted warning is a copy with `severity:'error'` and `isWarningAsError:true`, everything else is passed through).
 * @param {object[]} diagnostics `{uri,start,length,code,message,severity,range}` records; an optional `warningLevel`
 *   on a record overrides the catalog's level for that code.
 * @param {object} [settings]
 * @param settings.sources file texts for `#pragma` handling: Map uri->SourceText|string, iterable of `{uri,text}`, or `{uri:text}`
 * @param settings.directives Map uri -> the directive trivia the lexer recorded for that file (`parse().directives`); when
 *   present for a file, its `#pragma warning` directives come from the syntax tree (inactive regions already excluded)
 *   and the source text is not scanned again
 * @param settings.pragmas Map uri -> `{directives,diagnostics}` already read for that file (diagnostics/pragma-trivia.js); takes
 *   precedence over `directives` and over scanning the text
 * @param settings.options `{noWarn, warnAsError, warnNotAsError, warningLevel, treatWarningsAsErrors, preprocessorSymbols}`
 *   (a CompilationOptions works). Id lists are arrays or `;`/`,` separated strings of ids or numbers, normalised with
 *   `normalizeDiagnosticId`; `warnAsError:true` is the same as `treatWarningsAsErrors:true`; `warningLevel` defaults to 4.
 * @param settings.suppressions SuppressMessage-style records `{id,scope?,target?,uri?,span?,spans?,excludeSpans?}`: `id`
 *   is the check id (text after ':' ignored, case-sensitive); `span`/`spans` (`{uri?,start,end}`) are the declarations
 *   the attribute covers; a record without span and target is compilation-wide; a record with only `target` needs
 *   `resolveTarget`; scope 'namespace' also needs `excludeSpans` (the declarations nested in the namespace).
 * @param settings.resolveTarget `(suppression)=>spans[]` for records whose Target was not resolved to spans
 * @param settings.includeDirectiveDiagnostics also report the `#pragma` directive warnings of `sources` (CS1633, ...)
 * @param settings.isCompilerDiagnostic predicate for diagnostics SuppressMessage must not touch (default: catalog ids)
 */
export function applySuppression(diagnostics,{sources=null,directives=null,pragmas=null,options={},suppressions=[],resolveTarget=null,includeDirectiveDiagnostics=false,isCompilerDiagnostic=defaultIsCompilerDiagnostic}={}){
  const texts=sourceTexts(sources),preprocessorSymbols=options?.preprocessorSymbols??[],parsed=new Map(),maps=new Map();
  const parse=uri=>{if(!parsed.has(uri))parsed.set(uri,pragmas?.has(uri)?pragmas.get(uri):directives?.has(uri)?{directives:pragmaDirectivesFromSyntax(directives.get(uri)),diagnostics:[]}:texts.has(uri)?parsePragmaDirectives(texts.get(uri),{preprocessorSymbols}):{directives:[],diagnostics:[]});return parsed.get(uri);};
  const mapOf=uri=>{if(!maps.has(uri))maps.set(uri,new PragmaWarningMap(parse(uri).directives));return maps.get(uri);};
  const warningLevel=options?.warningLevel??4,general=options?.treatWarningsAsErrors===true||options?.warnAsError===true;
  const specific=new Map();
  for(const id of idList(options?.warnAsError))specific.set(id,'error');
  for(const id of idList(options?.warnNotAsError))specific.set(id,'default');
  for(const id of idList(options?.noWarn))specific.set(id,'suppress');
  const records=suppressions.map(s=>{
    const scope=typeof s.scope==='string'?s.scope.toLowerCase():null;
    let spans=s.spans??(s.span?[{uri:s.uri,start:s.span.start,end:s.span.end}]:null);
    if(!spans&&s.target!=null)spans=resolveTarget?.(s)??[];
    return {id:String(s.id).split(':')[0].trim(),scope,spans,global:!spans&&(scope===null||scope==='module'),excludeSpans:s.excludeSpans??null};
  });
  const attributeSuppressed=d=>!isCompilerDiagnostic(d)&&records.some(r=>r.id===d.code&&(r.global||!!r.spans&&r.spans.some(span=>within(d,span))&&(r.scope!=='namespace'||!!r.excludeSpans&&!r.excludeSpans.some(span=>within(d,span)))));
  const levelOf=d=>d.warningLevel??diagnosticDescriptor(d.code)?.warningLevel??1;

  const all=[];
  if(includeDirectiveDiagnostics)for(const [uri,text] of texts)for(const d of parse(uri).diagnostics){
    all.push({uri,start:d.start,length:d.length,code:d.code,message:formatMessage(d.code,d.args),severity:'warning',range:{start:positionAt(text,d.start),end:positionAt(text,d.start+d.length)}});
  }
  for(const d of diagnostics)all.push(d);
  const result=[];
  for(const d of all){
    if(d.severity==='error'){result.push(d);continue;}
    if(levelOf(d)>warningLevel)continue;
    const report=specific.get(d.code);
    if(report==='suppress')continue;
    if(d.uri!==undefined&&texts.has(d.uri)&&mapOf(d.uri).stateAt(d.code,d.start)==='disabled')continue;
    if(records.length&&attributeSuppressed(d))continue;
    if(report==='error'||report===undefined&&general&&d.severity==='warning')result.push({...d,severity:'error',isWarningAsError:true});
    else result.push(d);
  }
  return result;
}
