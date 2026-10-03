/** Reserved and contextual keyword tables mirroring Roslyn SyntaxFacts.GetKeywordKind / GetContextualKeywordKind. */
const pascal = word => word.replace(/^_+/, '').replace(/^./, c => c.toUpperCase());
const special = { foreach: 'ForEach', stackalloc: 'StackAlloc', sizeof: 'SizeOf', typeof: 'TypeOf', readonly: 'ReadOnly', sbyte: 'SByte', uint: 'UInt', ulong: 'ULong', ushort: 'UShort', nameof: 'NameOf', orderby: 'OrderBy', typevar: 'TypeVar',
  __arglist: 'ArgList', __makeref: 'MakeRef', __reftype: 'RefType', __refvalue: 'RefValue', endif: 'EndIf', endregion: 'EndRegion', r: 'Reference' };
const kindName = word => (special[word] ?? pascal(word)) + 'Keyword';
const table = words => Object.freeze(Object.fromEntries(words.split(' ').map(w => [w, kindName(w)])));
/** C# reserved keywords (never identifiers unless @-escaped). */
export const reservedKeywordKinds = table('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while __arglist __makeref __reftype __refvalue');
/** Contextual keywords: identifiers that the parser converts to keywords by position. */
export const contextualKeywordKinds = Object.freeze({ ...table('yield partial alias global assembly module type field method param property typevar get set add remove where from group join into let by select orderby on equals ascending descending nameof async await when or and not with init record managed unmanaged required scoped file allows extension var'), _: 'UnderscoreToken' });
/** Keywords that are only meaningful inside preprocessor directives. */
export const preprocessorKeywordKinds = table('if else elif endif region endregion define undef warning error line pragma hidden checksum disable restore r load nullable enable warnings annotations default true false');
/** Identifiers that name types by convention but have no keyword kind in Roslyn. */
export const contextualTypeNames = Object.freeze(new Set(['dynamic', 'nint', 'nuint', 'notnull']));
export const reservedKeywords = Object.freeze(new Set(Object.keys(reservedKeywordKinds)));
export const contextualKeywords = Object.freeze(new Set(Object.keys(contextualKeywordKinds)));
/** Contextual words the pre-lossless lexer tokenised as keywords; the token stream keeps doing so for editor consumers. */
export const legacyContextual = Object.freeze(new Set(['var', 'async', 'await', 'partial', 'get', 'set']));
/** Every word highlighted as a keyword: reserved keywords plus the legacy contextual six. */
export const keywords = new Set([...reservedKeywords, ...legacyContextual]);
export const predefinedTypes = Object.freeze(new Set('bool byte sbyte short ushort int uint long ulong float double decimal char string object void'.split(' ')));
export function keywordKind(text) { return Object.hasOwn(reservedKeywordKinds, text) ? reservedKeywordKinds[text] : 'None'; }
export function contextualKeywordKind(text) { return Object.hasOwn(contextualKeywordKinds, text) ? contextualKeywordKinds[text] : 'None'; }
export function preprocessorKeywordKind(text) { return Object.hasOwn(preprocessorKeywordKinds, text) ? preprocessorKeywordKinds[text] : 'None'; }
export function isReservedKeyword(text) { return reservedKeywords.has(text); }
export function isContextualKeyword(text) { return contextualKeywords.has(text); }
