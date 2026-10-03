import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText, BoundedCache } from '@sharpforge/text';
import { lex,parse,parseExpression } from '@sharpforge/syntax';

test('text: immutable snapshots and UTF-16 positions',()=>{
 const s=new SourceText('α😀\r\nline\rthird\n','a.cs',7);
 assert.equal(s.length,16);assert.deepEqual(s.lineStarts,[0,5,10,16]);
 assert.deepEqual(s.positionAt(3),{line:0,character:3});assert.equal(s.offsetAt({line:1,character:2}),7);
 assert.equal(s.withChange(5,4,'ok').text,'α😀\r\nok\rthird\n');assert.equal(s.version,7);assert.equal(s.withChange(0,0,'!').version,8);
 assert.throws(()=>{s.text='mutated';},TypeError);assert.throws(()=>s.withChange(-1,0,''),RangeError);
});
test('text: out-of-range LSP columns clamp before line ending',()=>{
 const s=new SourceText('abc\r\nx');assert.equal(s.offsetAt({line:0,character:999}),3);assert.equal(s.offsetAt({line:99,character:999}),6);
});
test('text: empty documents and source size validation',()=>{const s=new SourceText('');assert.deepEqual(s.lineStarts,[0]);assert.deepEqual(s.positionAt(-10),{line:0,character:0});assert.throws(()=>new SourceText(null),TypeError);});
test('cache: bounded eviction',()=>{const c=new BoundedCache(2);c.getOrAdd('a',()=>1);c.getOrAdd('b',()=>2);c.getOrAdd('c',()=>3);assert.equal(c.map.size,2);assert.equal(c.map.has('a'),false);assert.equal(c.getOrAdd('b',()=>9),2);});
for(const text of [
 '// before\r\nint x = 1; /* middle */\nConsole.WriteLine(x); // after',
 'using System;\nclass A { string s = @"two ""quotes""\nand lines"; }',
 'int café = 0xFF + 0b1010 + 1_000; string @class = "\\u03b1\\n";',
 '"unfinished\\', '/* unterminated', '', '   \n\t', '💥 #bad\n'
])test('lexer: exact trivia roundtrip '+JSON.stringify(text.slice(0,25)),()=>{
 const source=new SourceText(text),r=lex(source);assert.equal(r.tokens.map(t=>t.green.fullText).join(''),text);assert.equal(r.tokens.at(-1).kind,'eof');
 for(const t of r.tokens){assert(t.start>=0&&t.end<=text.length&&t.start<=t.end);assert(Object.isFrozen(t.green));}
});
test('lexer: unchanged token interning preserves identity',()=>{const cache=new BoundedCache(),a=lex(new SourceText('int x = 1;'),cache),b=lex(new SourceText('int x = 2;'),cache);assert.equal(a.tokens[0].green,b.tokens[0].green);assert.notEqual(a.tokens[3].green,b.tokens[3].green);assert(b.internedTokenHits>0);});
for(const [text,code] of [['"unclosed','CS1010'],['/*bad','CS1035'],['$"{x"','CS8076'],['#if true\n','SF1001'],['3.2f','SF1005'],['123L','SF1003'],['0xZZ','CS1013'],["'ab'",'CS1012']])test('lexer: diagnostic '+code+' '+text,()=>{assert(lex(new SourceText(text)).diagnostics.some(d=>d.code===code));});
test('parser: precedence and right associative assignments',()=>{const p=parseExpression('a = b = 1 + 2 * 3');assert.equal(p.diagnostics.length,0);assert.equal(p.expression.right.kind,'Assignment');assert.equal(p.expression.right.right.right.operator,'*');});
test('parser: syntax tree survives missing tokens',()=>{const r=parse('class A { static void Main( { int x = ; Console.WriteLine(x) }');assert(r.diagnostics.length>0);assert(r.root);assert(r.tokens.length>5);assert(r.diagnostics.length<=200);});
test('parser: deterministic punctuation fuzz recovers without throwing',()=>{
 let seed=0x12345678;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};const atoms=['class','if','else','int','new','foo','42','"s"','(',')','{','}','[',']',';',',','.','=','+','?','return','static','void'];
 for(let i=0;i<300;i++){let text='';for(let j=0;j<60;j++)text+=atoms[rand()%atoms.length]+' ';const r=parse(text);assert(r.root);assert(r.diagnostics.length<=200);assert.equal(r.tokens.map(t=>t.green.fullText).join(''),text);}
});
test('parser: nesting budget reports a diagnostic',()=>{const r=parse('Console.WriteLine('+'('.repeat(230)+'1'+')'.repeat(230)+');');assert(r.diagnostics.length>0);});
