import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lex, parse, parseExpression, SyntaxTree, scanEscape, simpleEscapes, scanNumber, scanReal, integerType, parseDecimal, decimalToString, scanIdentifier, identifierEquals, scanRawString, encodeUtf8, scanInterpolated, evaluatePreprocessorExpression, createLineMap,
  keywords, reservedKeywords, contextualKeywords, keywordKind, contextualKeywordKind, reservedKeywordKinds, contextualKeywordKinds, punctuationKinds, binaryOperators, assignmentOperators, Precedence, scanOperator } from '@sharpforge/syntax';
import { compile } from '@sharpforge/compiler';
import { SourceText } from '@sharpforge/text';
import { repoRoot, fixtureRoot, filesUnder } from './support/syntax-reference.js';

const B = String.fromCharCode(92), Q3 = '"""';
const codes = (text, options) => lex(new SourceText(text), undefined, { profile: false, ...options }).diagnostics.map(d => d.code);
const tokens = (text, options) => lex(new SourceText(text), undefined, options).tokens;
const kinds = text => tokens(text).slice(0, -1).map(t => t.kind);
// ---- SF-A01-T04.1 / B02: scanner modules and the shared escape table -------------------------------------------------
test('lexer modules: scanner is split and one escape module serves strings, chars and interpolations', () => {
  const directory = join(repoRoot, 'packages/syntax/src/lexer');
  for (const module of ['scanner', 'numbers', 'reals', 'strings', 'identifiers', 'operators', 'keywords', 'escapes', 'trivia', 'raw-strings', 'utf8-suffix']) assert(readFileSync(join(directory, module + '.js'), 'utf8').length > 0);
  assert.match(readFileSync(join(directory, 'strings.js'), 'utf8'), /from '\.\/escapes\.js'/); assert.match(readFileSync(join(repoRoot, 'packages/syntax/src/interpolation.js'), 'utf8'), /from '\.\/lexer\/escapes\.js'/);
  for (const file of filesUnder(join(repoRoot, 'packages/syntax/src'), name => name.endsWith('.js'))) if (!file.endsWith('escapes.js')) assert(!/n: '\\n', r: '\\r'/.test(readFileSync(file, 'utf8')), 'duplicate escape table in ' + file);
  assert.equal(simpleEscapes.n, '\n'); assert.equal(simpleEscapes.e, '\x1b');
});
test('B02: hex and long Unicode escapes lex in regular, char and interpolated literals', () => {
  assert.deepEqual(scanEscape(B + 'x41', 0), { end: 4, value: 'A' }); assert.equal(scanEscape(B + 'x1F600', 0).end, 6, 'at most four hex digits'); assert.equal(scanEscape(B + 'x9z', 0).value, '\t');
  assert.equal(scanEscape(B + 'U0001F600', 0).value, String.fromCodePoint(0x1F600)); assert.equal(scanEscape(B + 'U0001F600', 0).value.length, 2, 'surrogate pair output'); assert.equal(scanEscape(B + 'u00e9', 0).value, String.fromCharCode(0xe9));
  assert.match(scanEscape(B + 'U00110000', 0).error, /10FFFF/); assert(scanEscape(B + 'xZ', 0).error); assert(scanEscape(B + 'u12', 0).error); assert(scanEscape(B + 'q', 0).error);
  const string = tokens('"' + B + 'x41' + B + 'U0001F600' + B + 'u0042"')[0]; assert.equal(string.value, 'A' + String.fromCodePoint(0x1F600) + 'B');
  assert.equal(tokens("'" + B + "x41'")[0].value, 'A'); assert.equal(tokens('$"' + B + 'x41{1}' + B + 'U0001F600"')[0].value[0].text, 'A'); assert.equal(tokens('$"' + B + 'x41{1}' + B + 'U0001F600"')[0].value[2].text, String.fromCodePoint(0x1F600));
  assert.deepEqual(codes('"' + B + 'U00110000"'), ['CS1009']); assert.deepEqual(codes('"' + B + 'q"'), ['CS1009']); assert.deepEqual(codes('$"' + B + 'q"'), ['CS1009']); assert.deepEqual(codes("'" + B + "U0001F600'"), ['CS1012']);
  assert.equal(compile('Console.WriteLine("' + B + 'x41' + B + 'U0001F600" + $"' + B + 'x42{1}");').success, true);
});
test('B04: the \\e escape is a C# 13 feature', () => {
  for (const source of ['var s = "' + B + 'e";', "var c = '" + B + "e';", 'var s = $"' + B + 'e{1}";']) {
    assert.deepEqual(parse(source, undefined, { languageVersion: '12' }).diagnostics.map(d => d.code), ['CS9202'], source); assert.match(parse(source, undefined, { languageVersion: '12' }).diagnostics[0].message, /string escape character.*13\.0/);
    assert.deepEqual(parse(source, undefined, { languageVersion: '13' }).diagnostics, []); assert.deepEqual(parse(source, undefined, { languageVersion: 'latest' }).diagnostics, []);
  }
  assert.equal(tokens('"' + B + 'e"')[0].value, '\x1b');
});
// ---- SF-A01-T04.2: integer literals ---------------------------------------------------------------------------------
test('integers: C# type selection on exact values', () => {
  const type = text => { const token = tokens(text, { profile: false })[0]; return [token.literal.type, String(token.literal.value)]; };
  assert.deepEqual(type('0xFFFFFFFF'), ['uint', '4294967295']); assert.deepEqual(type('2147483648'), ['uint', '2147483648']); assert.deepEqual(type('9223372036854775808UL'), ['ulong', '9223372036854775808']);
  assert.deepEqual(type('2147483647'), ['int', '2147483647']); assert.deepEqual(type('4294967296'), ['long', '4294967296']); assert.deepEqual(type('9223372036854775808'), ['ulong', '9223372036854775808']); assert.deepEqual(type('18446744073709551615'), ['ulong', '18446744073709551615']);
  assert.deepEqual(type('1U'), ['uint', '1']); assert.deepEqual(type('1L'), ['long', '1']); assert.deepEqual(type('1uL'), ['ulong', '1']); assert.deepEqual(type('1Lu'), ['ulong', '1']); assert.deepEqual(type('4294967296u'), ['ulong', '4294967296']); assert.deepEqual(type('9223372036854775808L'), ['ulong', '9223372036854775808']);
  assert.deepEqual(type('0b1010'), ['int', '10']); assert.deepEqual(type('0B1111_0000'), ['int', '240']); assert.deepEqual(type('0x_FF'), ['int', '255']); assert.deepEqual(type('0b_1'), ['int', '1']); assert.deepEqual(type('1_000_000'), ['int', '1000000']); assert.deepEqual(type('0x8000000000000000'), ['ulong', '9223372036854775808']);
  assert.equal(integerType(0x7FFFFFFFn), 'int'); assert.equal(integerType(1n << 64n), null); assert.equal(typeof tokens('9223372036854775807L')[0].literal.value, 'bigint');
  assert.deepEqual(codes('18446744073709551616'), ['CS1021']); assert.deepEqual(codes('0xFFFFFFFFFFFFFFFFF'), ['CS1021']); assert.deepEqual(codes('0x'), ['CS1013']); assert.deepEqual(codes('1_'), ['CS1013']); assert.deepEqual(codes('0b'), ['CS1013']);
  assert.deepEqual(codes('2147483648 4294967296 1UL 0xFFFFFFFF'), [], 'no SF1003/SF1004 from the scanner itself');
  assert.equal(scanNumber('123abc', 0).end, 3); assert.equal(tokens('1.ToString()')[0].text, '1'); assert.deepEqual(kinds('1..2'), ['integer', '..', 'integer']);
});
test('integers and reals: back-end profile diagnostics stay on the legacy entry points only', () => {
  assert(lex(new SourceText('123L')).diagnostics.some(d => d.code === 'SF1003')); assert(lex(new SourceText('3.2f')).diagnostics.some(d => d.code === 'SF1005')); assert(lex(new SourceText('5000000000')).diagnostics.some(d => d.code === 'SF1004'));
  assert.deepEqual(SyntaxTree.parseText('var a = 123L + 3.2f + 5000000000 + 1.5m;').getDiagnostics(), []);
  for (const file of filesUnder(join(repoRoot, 'packages/syntax/src/lexer'), name => name.endsWith('.js'))) if (!/numbers|reals|scanner/.test(file)) assert(!/SF100[345]/.test(readFileSync(file, 'utf8')), file);
});
// ---- SF-A01-T04.3: real literals ------------------------------------------------------------------------------------
test('reals: float, double and exact decimal values', () => {
  const literal = text => tokens(text, { profile: false })[0].literal;
  assert.deepEqual([literal('1.5f').type, literal('1.5f').value], ['float', 1.5]); assert.deepEqual([literal('1e10d').type, literal('1e10d').value], ['double', 1e10]); assert.deepEqual([literal('.5').type, literal('.5').value], ['double', 0.5]);
  assert.equal(literal('0.1f').value, Math.fround(0.1)); assert.notEqual(literal('0.1f').value, 0.1, 'rounded to single'); assert.equal(literal('16777217f').value, 16777216); assert.equal(literal('1f').type, 'float'); assert.equal(literal('1d').type, 'double'); assert.equal(literal('1E+3').value, 1000);
  const max = literal('79228162514264337593543950335m'); assert.equal(max.type, 'decimal'); assert.deepEqual(max.value, { mantissa: 79228162514264337593543950335n, scale: 0 }); assert.equal(max.value.mantissa, (1n << 96n) - 1n);
  assert.deepEqual(literal('1.10m').value, { mantissa: 110n, scale: 2 }); assert.equal(decimalToString(literal('1.10m').value), '1.10'); assert.deepEqual(literal('1e2m').value, { mantissa: 100n, scale: 0 }); assert.deepEqual(literal('.5m').value, { mantissa: 5n, scale: 1 });
  assert.equal(decimalToString(literal('0.0000000000000000000000000001m').value), '0.0000000000000000000000000001'); assert.equal(decimalToString(literal('1.2345678901234567890123456789m').value), '1.2345678901234567890123456789');
  assert.deepEqual(parseDecimal('0', '00000000000000000000000000015'), { mantissa: 2n, scale: 28 }, 'round half to even'); assert.deepEqual(parseDecimal('0', '00000000000000000000000000025'), { mantissa: 2n, scale: 28 }); assert.equal(parseDecimal('79228162514264337593543950336'), null);
  assert.deepEqual(codes('79228162514264337593543950336m'), ['CS0594']); assert.deepEqual(codes('1e39f'), ['CS0594']); assert.deepEqual(codes('1e309'), ['CS0594']); assert.deepEqual(codes('1e400d'), ['CS0594']); assert.deepEqual(codes('1e-400 3.4028235e38f 1.7976931348623157e308'), []);
  assert.equal(scanReal('1.5e3x', 0).end, 5); assert.deepEqual(kinds('1e'), ['integer', 'identifier']); assert.deepEqual(kinds('1.5.ToString()').slice(0, 2), ['double', '.']);
});
// ---- SF-A01-T04.4: identifiers --------------------------------------------------------------------------------------
test('identifiers: Unicode escapes, formatting characters and verbatim names', () => {
  assert.equal(tokens(B + 'u0061bc')[0].value, 'abc'); assert.equal(tokens('x' + B + 'u0062c')[0].value, 'xbc'); assert.equal(tokens(B + 'U00000041z')[0].value, 'Az'); assert.equal(tokens('@' + B + 'u0063lass')[0].value, 'class');
  const escapedKeyword = tokens('cl' + B + 'u0061ss')[0]; assert.equal(escapedKeyword.kind, 'identifier', 'an escaped keyword is an identifier'); assert.equal(escapedKeyword.value, 'class');
  assert.equal(tokens('@class')[0].kind, 'identifier'); assert.equal(tokens('@class')[0].value, 'class'); assert.equal(tokens('class')[0].kind, 'class');
  const joiner = String.fromCharCode(0x200D), softHyphen = String.fromCharCode(0xAD); assert.equal(tokens('a' + joiner + 'b')[0].value, 'ab', 'formatting characters are not part of the value'); assert.equal(tokens('c' + softHyphen + 'd')[0].text.length, 3);
  assert.equal(tokens('e' + String.fromCharCode(0x301))[0].text.length, 2, 'combining marks continue an identifier'); assert.equal(tokens('f' + String.fromCharCode(0x203F) + 'g')[0].value.length, 3); assert.equal(tokens(String.fromCharCode(0x2160) + 'x')[0].kind, 'identifier', 'letter numbers start an identifier');
  assert(identifierEquals('caf' + String.fromCharCode(0xe9), 'cafe' + String.fromCharCode(0x301)), 'NFC comparison'); assert(!identifierEquals('a', 'b')); assert.equal(scanIdentifier('1abc', 0), null);
  assert.deepEqual(codes(B + 'u0031x'), ['CS1056'], 'an escaped digit cannot start an identifier');
});
// ---- SF-A01-T04.5: raw strings --------------------------------------------------------------------------------------
test('raw strings: quote counts, indentation and diagnostics', () => {
  const value = text => { const token = tokens(text)[0]; assert.equal(token.kind, 'string'); return token.value; };
  assert.equal(value(Q3 + 'a "b" ""c""' + ' ' + Q3), 'a "b" ""c"" '); assert.equal(value('"' + Q3 + 'x ' + Q3 + ' y' + Q3 + '"'), 'x ' + Q3 + ' y'); assert.equal(value(Q3 + '\n    a\n      b\n\n    c\n    ' + Q3), 'a\n  b\n\nc');
  assert.equal(value(Q3 + '\r\n\tx\r\n\t' + Q3), 'x'); assert.equal(value(Q3 + '\n' + B + 'n {x}\n' + Q3), B + 'n {x}'); assert.equal(value(Q3 + '   ' + Q3), '   '); assert.equal(tokens(Q3 + 'a' + Q3)[0].syntaxKind, 'SingleLineRawStringLiteralToken'); assert.equal(tokens(Q3 + '\na\n' + Q3)[0].syntaxKind, 'MultiLineRawStringLiteralToken');
  assert.deepEqual(codes(Q3 + 'abc'), ['CS8997']); assert.deepEqual(codes(Q3 + 'abc' + Q3 + '"'), ['CS8998']); assert.deepEqual(codes(Q3 + '\n  x\n y\n  ' + Q3), ['CS8999']); assert.deepEqual(codes(Q3 + '\nx' + Q3), ['CS9000']);
  assert.deepEqual(codes(Q3 + '\n' + Q3), ['CS9002']); assert.deepEqual(codes(Q3 + '\n\t x\n  ' + Q3), ['CS9003']); assert.deepEqual(codes('$' + Q3 + 'a{{b}}' + Q3), ['CS9006']); assert.deepEqual(codes('$$' + Q3 + 'a{b}}}' + Q3), ['CS9007']);
  assert.equal(scanRawString(Q3 + 'x' + Q3 + ' tail', 0, () => {}).end, 7);
  for (const text of [Q3 + 'abc', Q3 + '\n  x\n y\n  ' + Q3, Q3 + '\nx' + Q3]) assert.equal(SyntaxTree.parseText('var s = ' + text + ';').toFullString(), 'var s = ' + text + ';');
});
// ---- SF-A01-T04.6: UTF-8 literals -----------------------------------------------------------------------------------
test('utf8 literals: suffix on regular, verbatim and raw strings with encoded bytes', () => {
  const e = String.fromCharCode(0xe9), token = tokens('"h' + e + 'llo"u8')[0];
  assert.equal(token.syntaxKind, 'Utf8StringLiteralToken'); assert.equal(token.text, '"h' + e + 'llo"u8'); assert.deepEqual([...token.bytes], [0x68, 0xC3, 0xA9, 0x6C, 0x6C, 0x6F]); assert.equal(token.value, 'h' + e + 'llo');
  assert.equal(tokens('@"a""b"U8')[0].syntaxKind, 'Utf8StringLiteralToken'); assert.deepEqual([...tokens('@"a""b"U8')[0].bytes], [0x61, 0x22, 0x62]); assert.equal(tokens(Q3 + 'r' + Q3 + 'u8')[0].syntaxKind, 'Utf8SingleLineRawStringLiteralToken'); assert.equal(tokens(Q3 + '\nr\n' + Q3 + 'u8')[0].syntaxKind, 'Utf8MultiLineRawStringLiteralToken');
  assert.deepEqual([...encodeUtf8(String.fromCodePoint(0x1F600) + String.fromCharCode(0x7FF, 0x800)).bytes], [0xF0, 0x9F, 0x98, 0x80, 0xDF, 0xBF, 0xE0, 0xA0, 0x80]);
  assert.deepEqual(codes('"' + B + 'uD800"u8'), ['CS9026']); assert.deepEqual(codes('"' + B + 'uDC00x"u8'), ['CS9026']); assert.deepEqual(codes('"' + B + 'uD83D' + B + 'uDE00"u8'), []); assert.equal(tokens('"a" u8')[0].syntaxKind, 'StringLiteralToken');
  assert.equal(parse('var s = "x"u8;', undefined, { languageVersion: '10' }).diagnostics[0].code, 'CS8936');
});
// ---- SF-A01-T04.7: interpolated strings ------------------------------------------------------------------------------
test('interpolation: structured segments, nested holes, format clauses and raw forms', () => {
  const structure = text => tokens(text)[0].structure, holes = text => structure(text).segments.filter(s => s.type === 'hole');
  const nested = holes('$"a{$"b{c + $"d{e}"}"}f"'); assert.equal(nested.length, 1); assert.equal(nested[0].tokens.length, 1); assert.equal(nested[0].tokens[0].kind, 'interpolated');
  const format = holes('$"{f(a, b):N2}{(c ? d : e),-5:x:y}"'); assert.equal(format[0].formatValue, 'N2'); assert.equal(format[0].comma, -1, 'a comma inside parentheses is not an alignment'); assert.equal(format[1].formatValue, 'x:y'); assert.equal(format[1].alignTokens.map(t => t.text).join(''), '-5');
  const raw = structure('$$$' + Q3 + 'a {{x}} {{{y:N1}}} b' + Q3); assert.equal(raw.dollars, 3); assert.equal(raw.segments.filter(s => s.type === 'hole').length, 1); assert.equal(raw.segments[0].value, 'a {{x}} '); assert.equal(raw.segments[1].formatValue, 'N1');
  assert.equal(structure('$' + Q3 + '\n    a {x}\n      b\n    ' + Q3).segments.map(s => s.value ?? '{}').join('|'), 'a |{}|\n  b'); assert.equal(holes('$@"x ""{a}"" y"').length, 1); assert.equal(holes('@$"{a}"').length, 1);
  const multiLine = SyntaxTree.parseText('var s = $"{\n  a\n}";', { languageVersion: '10' }); assert.deepEqual(multiLine.getDiagnostics().map(d => d.code), ['CS8967'], 'newlines in holes are a C# 11 feature, reported with the dedicated diagnostic Roslyn uses');
  for (const text of ['$"a{$"b{c + $"d{e}"}"}f"', '$"{f(a, b):N2}{(c ? d : e),-5:x:y}"', '$$$' + Q3 + 'a {{x}} {{{y:N1}}} b' + Q3, '$' + Q3 + '\n    a {x}\n      b\n    ' + Q3, '$"{a', '$"{a,', '$"{a:N', '$"{', '$"}"', '$"{a b}"', '$"{}"']) assert.equal(SyntaxTree.parseText('x = ' + text + ';').toFullString(), 'x = ' + text + ';', text);
  const tree = SyntaxTree.parseText('$"a{b,3:N2}c"').root.members[0].statement.expression; assert.deepEqual(tree.contents.map(c => c.kind), ['InterpolatedStringText', 'Interpolation', 'InterpolatedStringText']);
  assert.equal(tree.contents[1].alignmentClause.value.toString(), '3'); assert.equal(tree.contents[1].formatClause.formatStringToken.text, 'N2'); assert.equal(tree.stringStartToken.kind, 'InterpolatedStringStartToken');
  assert(codes('$"{x"').includes('CS8076')); assert.equal(typeof scanInterpolated, 'function');
  assert.deepEqual(tokens('$"a{b,3:N2}c{{d}}"')[0].value.map(p => p.text ?? [p.expression, p.alignment, p.format]), ['a', ['b', 3, 'N2'], 'c{d}'], 'flattened parts stay available to existing consumers');
});
// ---- SF-A01-T04.8: conditional compilation --------------------------------------------------------------------------
test('directives: conditional compilation skips inactive regions without lexing them', () => {
  const source = '#define A\n#if A && !B\nint x;\n#elif B\nthis is "not lexed\n#if NESTED\n\'\n#else\n$"{\n#endif\n#else\n/* also skipped\n#endif\nint y;';
  const result = lex(new SourceText(source), undefined, {}); assert.deepEqual(result.diagnostics, []); assert.deepEqual(result.tokens.slice(0, -1).map(t => t.text), ['int', 'x', ';', 'int', 'y', ';']);
  const trivia = result.tokens.flatMap(t => t.leadingTrivia).map(t => t.kind);
  assert.deepEqual(trivia.filter(k => k !== 'EndOfLineTrivia'), ['DefineDirectiveTrivia', 'IfDirectiveTrivia', 'ElifDirectiveTrivia', 'DisabledTextTrivia', 'IfDirectiveTrivia', 'DisabledTextTrivia', 'ElseDirectiveTrivia', 'DisabledTextTrivia', 'EndIfDirectiveTrivia', 'ElseDirectiveTrivia', 'DisabledTextTrivia', 'EndIfDirectiveTrivia']);
  assert.deepEqual(result.directives.map(d => [d.structure.directive, d.structure.isActive, d.structure.branchTaken]).slice(1, 4), [['if', true, true], ['elif', true, false], ['if', false, false]]);
  assert.deepEqual(tokens('#if DEBUG\na\n#else\nb\n#endif', { preprocessorSymbols: ['DEBUG'] })[0].text, 'a'); assert.deepEqual(tokens('#if DEBUG\na\n#else\nb\n#endif')[0].text, 'b');
  assert.deepEqual(tokens('#undef X\n#if X\na\n#else\nb\n#endif', { preprocessorSymbols: ['X'] })[0].text, 'b');
  assert.deepEqual(codes('#if A\nx'), ['CS1027']); assert.deepEqual(codes('#endif'), ['CS1028']); assert.deepEqual(codes('#else'), ['CS1028']); assert.deepEqual(codes('#elif X'), ['CS1028']); assert.deepEqual(codes('#if A\n#else\n#else\n#endif'), ['CS1028']);
  assert.deepEqual(codes('#if true\n'), ['CS1027']); assert.deepEqual(codes('int x;\n#define A'), ['CS1032']); assert.deepEqual(codes('#if (\n#endif'), ['CS1517']); assert.deepEqual(codes('#if A junk\n#endif'), ['CS1025']); assert.deepEqual(codes('x #if A'), ['CS1040']); assert.deepEqual(codes('#bad'), ['CS1024']);
  assert.deepEqual(codes('#region r\n#if A\n#endregion\n#endif'), ['CS1027', 'CS1038']); assert.deepEqual(codes('#if false\n#error no\n#line 0\n#pragma x\n#endif'), [], 'inactive directives are lexed without effect');
  for (const [expression, expected] of [['A', true], ['!A', false], ['A && B', false], ['A || B', true], ['(A || B) && !C', true], ['A == true', true], ['B != false', false], ['true', true], ['false || A', true], ['!(A && B)', true]]) assert.equal(evaluatePreprocessorExpression(expression, new Set(['A'])).value, expected, expression);
  assert(evaluatePreprocessorExpression('&& A', new Set()).error); assert.equal(compile('#if DEBUG\nint x = bad;\n#else\nint x = 2;\n#endif\nConsole.WriteLine(x);').success, true);
});
// ---- SF-A01-T04.9: other directives ---------------------------------------------------------------------------------
test('directives: region, diagnostics, line, pragma and nullable yield structured trivia', () => {
  const source = '#region Outer text\n#line 200 "Special.cs"\nint a;\n#line hidden\nint b;\n#line default\n#line (1, 2) - (3, 4) 5 "Span.cs"\nint c;\n#pragma warning disable CS0168, 219\n#pragma warning restore\n#pragma checksum "f.cs" "{406EA660-64CF-4C82-B6F0-42D48172A799}" "ab007f"\n#nullable enable\n#nullable disable warnings\n#warning careful\n#endregion\n';
  const result = lex(new SourceText(source), undefined, {}), structures = result.directives.map(d => d.structure), by = name => structures.filter(s => s.directive === name);
  assert.deepEqual(result.directives.map(d => d.kind), ['RegionDirectiveTrivia', 'LineDirectiveTrivia', 'LineDirectiveTrivia', 'LineDirectiveTrivia', 'LineSpanDirectiveTrivia', 'PragmaWarningDirectiveTrivia', 'PragmaWarningDirectiveTrivia', 'PragmaChecksumDirectiveTrivia', 'NullableDirectiveTrivia', 'NullableDirectiveTrivia', 'WarningDirectiveTrivia', 'EndRegionDirectiveTrivia']);
  assert.equal(by('region')[0].message, 'Outer text'); assert.deepEqual([by('line')[0].mode, by('line')[0].line, by('line')[0].file], ['number', 200, 'Special.cs']); assert.deepEqual(by('line')[3].start, { line: 1, character: 2 }); assert.equal(by('line')[3].characterOffset, 5);
  assert.deepEqual(by('pragma')[0].codes, ['CS0168', 'CS0219']); assert.equal(by('pragma')[1].action, 'restore'); assert.equal(by('pragma')[2].guid, '{406EA660-64CF-4C82-B6F0-42D48172A799}'); assert.deepEqual([by('nullable')[1].setting, by('nullable')[1].target], ['disable', 'warnings']);
  assert.deepEqual(result.diagnostics.map(d => [d.code, d.severity, d.message]), [['CS1030', 'warning', "#warning: 'careful'"]]);
  const error = lex(new SourceText('#error stop here'), undefined, {}).diagnostics[0]; assert.deepEqual([error.code, error.message, error.severity], ['CS1029', "#error: 'stop here'", 'error']);
  const map = createLineMap(result.source, result.directives), at = text => map.map(source.indexOf(text));
  assert.deepEqual(at('int a'), { line: 199, character: 0, path: 'Special.cs', hidden: false }); assert.equal(at('int b').hidden, true); assert.deepEqual(at('#line (1'), { line: 6, character: 0, path: 'Program.cs', hidden: false }); assert.deepEqual(at('int c'), { line: 0, character: 1, path: 'Span.cs', hidden: false });
  assert.equal(SyntaxTree.parseText(source).lineMap.map(source.indexOf('int a')).path, 'Special.cs');
  assert.deepEqual(codes('#endregion'), ['CS1028']); assert.deepEqual(codes('#region a'), ['CS1038']); assert.deepEqual(codes('#line 0'), ['CS1576']); assert.deepEqual(codes('#line x'), ['CS1576']); assert.deepEqual(codes('#nullable foo'), ['CS8637']); assert.deepEqual(codes('#nullable enable foo'), ['CS8638']);
  assert.deepEqual(lex(new SourceText('#pragma foo'), undefined, {}).diagnostics.map(d => [d.code, d.severity]), [['CS1633', 'warning']]); assert.equal(compile('#region r\n#nullable enable\n#pragma warning disable CS0168\nConsole.WriteLine(1);\n#endregion').success, true);
});
// ---- SF-A01-T04.10: script and file-based-app directives -------------------------------------------------------------
test('directives: shebang, #: and script-only directives', () => {
  const app = lex(new SourceText('#!/usr/bin/env dotnet\n#:package Humanizer@2.14.1\n#:sdk Microsoft.NET.Sdk.Web\n#:property LangVersion preview\nConsole.WriteLine(1);\n#:package Late@1\n'), undefined, {});
  assert.deepEqual(app.directives.map(d => d.kind), ['ShebangDirectiveTrivia', 'IgnoredDirectiveTrivia', 'IgnoredDirectiveTrivia', 'IgnoredDirectiveTrivia', 'IgnoredDirectiveTrivia']);
  assert.deepEqual(app.directives.slice(1, 4).map(d => [d.structure.key, d.structure.value]), [['package', 'Humanizer@2.14.1'], ['sdk', 'Microsoft.NET.Sdk.Web'], ['property', 'LangVersion preview']]);
  assert.deepEqual(app.diagnostics.map(d => d.code), ['CS9297'], '#: after the first token'); assert.equal(app.tokens[0].text, 'Console'); assert.equal(app.tokens[0].leadingTrivia.length, 4);
  assert.deepEqual(codes('#if A\n#endif\n#:sdk X\nx();'), ['CS9299']); assert.deepEqual(codes('#:sdk X\nx();', { fileBasedProgram: false }), ['CS9298']); assert.deepEqual(codes('x();\n#!late'), ['CS1024']);
  // Roslyn has no language-version gate for '#:' (see tests/syntax-directive-gates.test.js).
  assert.deepEqual(parse('#:sdk X\nx();', undefined, { languageVersion: '13' }).diagnostics.filter(d => d.code === 'CS9260'), []);
  const script = lex(new SourceText('#r "System.Xml"\n#load "other.csx"\nvar x = 1;\n#r "late"'), undefined, { script: true });
  assert.deepEqual(script.directives.map(d => [d.kind, d.structure.file]), [['ReferenceDirectiveTrivia', 'System.Xml'], ['LoadDirectiveTrivia', 'other.csx'], ['ReferenceDirectiveTrivia', 'late']]); assert.deepEqual(script.diagnostics.map(d => d.code), ['CS7011']);
  assert.deepEqual(codes('#r "a"\n#load "b"'), ['CS7011', 'CS8097']); assert.deepEqual(codes('#r nope', { script: true }), ['CS7010']);
});
// ---- SF-A01-T04.11 / B03: keywords ----------------------------------------------------------------------------------
test('keywords: reserved and contextual tables match Roslyn SyntaxFacts', () => {
  const dumps = filesUnder(fixtureRoot, name => name.endsWith('.cs.json')), seen = new Map();
  const visit = node => { if (Array.isArray(node[3])) node[3].forEach(visit); else if (/Keyword$|^UnderscoreToken$/.test(node[0]) && node[3]) seen.set(node[3], node[0]); };
  for (const file of dumps) visit(JSON.parse(readFileSync(file, 'utf8')).tree);
  assert(seen.size > 100, String(seen.size));
  for (const [text, kind] of seen) assert.equal(reservedKeywords.has(text) ? keywordKind(text) : contextualKeywordKind(text), kind, text);
  assert.equal(reservedKeywords.size, 81); for (const word of ['goto', 'delegate', 'event', 'operator', 'explicit', 'implicit', 'extern', 'fixed', 'unsafe', 'sizeof', 'stackalloc', 'volatile', 'sbyte', 'ushort', 'lock', 'float']) { assert(reservedKeywords.has(word), word); assert(keywords.has(word)); assert.equal(tokens(word)[0].kind, word); }
  for (const word of ['var', 'dynamic', 'nameof', 'when', 'record', 'init', 'required', 'file', 'scoped', 'field', 'extension', 'with', 'and', 'or', 'not', 'managed', 'unmanaged', 'yield', 'async', 'await', 'partial', 'get', 'set', 'add', 'remove', 'where', 'from', 'select', 'global', 'alias', 'allows']) { assert(!reservedKeywords.has(word), word); if (word !== 'dynamic') assert(contextualKeywords.has(word), word); }
  assert.equal(keywordKind('foreach'), 'ForEachKeyword'); assert.equal(keywordKind('stackalloc'), 'StackAllocKeyword'); assert.equal(keywordKind('var'), 'None'); assert.equal(contextualKeywordKind('var'), 'VarKeyword'); assert.equal(contextualKeywordKind('_'), 'UnderscoreToken'); assert.equal(contextualKeywordKind('int'), 'None'); assert.equal(contextualKeywordKind('dynamic'), 'None');
  assert.equal(reservedKeywordKinds.__arglist, 'ArgListKeyword'); assert.equal(contextualKeywordKinds.orderby, 'OrderByKeyword'); assert.deepEqual(parse('int yield = 1, record = 2, when = 3, file = 4; Console.WriteLine(yield + record + when + file);').diagnostics, []);
});
test('B03: goto is a keyword and never a local declaration', () => {
  for (const source of ['int i = 0; L: i++; if (i < 3) goto L;', 'switch (i) { case 0: goto case 1; case 1: goto default; default: break; }']) {
    const result = compile('int i = 0; ' + source); assert(!result.diagnostics.some(d => d.code === 'CS0246'), JSON.stringify(result.diagnostics.map(d => d.code))); assert(result.diagnostics.every(d => d.code !== 'CS1003' && d.code !== 'CS1525'));
  }
  const tree = SyntaxTree.parseText('goto L; goto case 1 + 2; goto default;'); assert.deepEqual(tree.getDiagnostics(), []); assert.deepEqual(tree.root.members.map(m => m.statement.kind), ['GotoStatement', 'GotoCaseStatement', 'GotoDefaultStatement']);
  assert.deepEqual(parse('L: goto L;').root.statements[0].body.kind, 'GotoStatement'); assert.equal(compile('L: goto L;').success, true, 'a goto to a label is compiled as a jump');
});
// ---- SF-A01-T04.12 / B01: operators ---------------------------------------------------------------------------------
test('operators: every punctuation token, split > tokens and the precedence table', () => {
  for (const [text, kind] of Object.entries(punctuationKinds)) { if (['"', "'", '$', '#', B].includes(text) || text.startsWith('>>')) continue; const token = tokens(text === '..' ? 'a..b' : text)[text === '..' ? 1 : 0]; assert.equal(token.text, text); assert.equal(token.syntaxKind, kind); }
  assert.deepEqual(kinds('a->b'), ['identifier', '->', 'identifier']); assert.deepEqual(kinds('a?.b'), ['identifier', '?', '.', 'identifier']); assert.deepEqual(kinds('a..b'), ['identifier', '..', 'identifier']); assert.deepEqual(kinds('a.b'), ['identifier', '.', 'identifier']);
  assert.deepEqual(kinds('x >>= 1'), ['identifier', '>', '>=', 'integer'], 'the scanner never merges > so nested generics close'); assert.deepEqual(kinds('a >>> b'), ['identifier', '>', '>', '>', 'identifier']); assert.equal(scanOperator('<<=', 0), '<<='); assert.equal(scanOperator('@', 0), null);
  const expression = text => SyntaxTree.parseText('x = ' + text + ';').root.members[0].statement.expression.right;
  assert.equal(expression('a >> b').kind, 'RightShiftExpression'); assert.equal(expression('a >> b').operatorToken.kind, 'GreaterThanGreaterThanToken'); assert.equal(expression('a >>> b').operatorToken.text, '>>>'); assert.equal(expression('a > > b').kind, 'GreaterThanExpression', 'separated tokens are not merged');
  assert.equal(expression('new List<List<int>>()').type.typeArgumentList.arguments[0].kind, 'GenericName'); assert.equal(expression('a << b >> c').kind, 'RightShiftExpression'); assert.equal(expression('a + b >> c').left.kind, 'AddExpression', 'shift binds looser than additive');
  for (const text of ['<<=', '>>=', '>>>=']) { assert.equal(Precedence.Assignment, 1); assert(assignmentOperators[text], text); } assert.deepEqual(binaryOperators['>>>'], [Precedence.Shift, 'UnsignedRightShiftExpression']); assert.equal(binaryOperators['<<'][0], binaryOperators['>>'][0]);
  assert.equal(parse('x = a >>> 1;', undefined, { languageVersion: '10' }).diagnostics[0].code, 'CS8936');
});
test('B01: shift compound assignments parse to Assignment nodes and compile', () => {
  for (const [text, operator] of [['x <<= 2', '<<='], ['x >>= 2', '>>='], ['x >>>= 2', '>>>=']]) { const parsed = parseExpression(text); assert.deepEqual(parsed.diagnostics, []); assert.equal(parsed.expression.kind, 'Assignment'); assert.equal(parsed.expression.operator, operator); assert.equal(parsed.expression.right.value, 2); }
  assert.equal(parseExpression('a = b <<= c >>= 1').expression.right.right.kind, 'Assignment', 'right associative');
  const result = compile('int x = 1; x <<= 4; x >>= 1; Console.WriteLine(x);'); assert.equal(result.success, true, JSON.stringify(result.diagnostics));
});
test('B05: is and as take a type or pattern operand', () => {
  const result = compile('object o = 1; Console.WriteLine(o is int);'); assert(!result.diagnostics.some(d => d.code === 'CS0103' || d.code === 'SF2006'), JSON.stringify(result.diagnostics.map(d => d.code)));
  const is = SyntaxTree.parseText('x = o is int;').root.members[0].statement.expression.right; assert.equal(is.kind, 'IsExpression'); assert.equal(is.right.kind, 'PredefinedType');
  const as = SyntaxTree.parseText('x = o as List<int>;').root.members[0].statement.expression.right; assert.equal(as.kind, 'AsExpression'); assert.equal(as.right.kind, 'GenericName');
  assert.equal(SyntaxTree.parseText('x = o is int i;').root.members[0].statement.expression.right.kind, 'IsPatternExpression'); assert.deepEqual(parseExpression('o is int').diagnostics, []); assert.equal(parseExpression('o is int').expression.kind, 'IsExpression');
});
