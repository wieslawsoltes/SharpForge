import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile, compileToAssembly } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30: the synthesized `PrintMembers` and `EqualityContract` of a record can be named by the program
// (`base.PrintMembers(builder)` in an override, `EqualityContract` in a member). Member lookup finds them and code
// generation emits the same symbols. Reference on real .NET: the Roslyn-pinned programs
// `reduced-types/record-printmembers-and-equality-contract` and `stress-records/document-model`
// (tests/compiler-stress-corpus.test.js). The diagnostics below are what Roslyn 5.3.0 reports for the same sources.

const records = `using System; using System.Text;
public record Block(string Id) { public string Contract => EqualityContract.Name; }
public record Heading(string Id, int Level) : Block(Id) {
  protected override bool PrintMembers(StringBuilder builder) { if (base.PrintMembers(builder)) builder.Append(", "); return true; }
}
public sealed record Leaf(int X) { public bool Print(StringBuilder builder) => PrintMembers(builder); }
public record struct Pixel(int X) { public bool Print(StringBuilder builder) => PrintMembers(builder); }
public class Plain { }`;
const errorsOf = body =>
  analyze([parse(new SourceText(`${records}\nstatic class Program { static void Main() { ${body} } }`, 'Program.cs'))], {})
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

test('A02-T30 PrintMembers and EqualityContract of a record bind inside the record and its derived records', () => {
  assert.deepEqual(errorsOf('Console.WriteLine(new Heading("a", 1).Contract);'), []);
  const result = compileToAssembly(`${records}\nstatic class Program { static void Main() { Console.WriteLine(new Heading("a", 1)); } }`, { name: 'Fixture' });
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error'),
    [],
  );
  assert.ok(result.assembly);
});

test('A02-T30 the synthesized record members are protected or private: CS0122 from outside, CS1061 on other types', () => {
  assert.deepEqual(errorsOf('new Heading("a", 1).PrintMembers(new StringBuilder());'), ['CS0122']);
  assert.deepEqual(errorsOf('Type contract = new Block("a").EqualityContract;'), ['CS0122']);
  assert.deepEqual(errorsOf('new Leaf(1).PrintMembers(new StringBuilder());'), ['CS0122']);
  assert.deepEqual(errorsOf('new Pixel(1).PrintMembers(new StringBuilder());'), ['CS0122']);
  assert.deepEqual(errorsOf('new Plain().PrintMembers(new StringBuilder());'), ['CS1061']);
});

test('A02-T30 the back ends that do not emit record contract members refuse a program that names one (SF2200)', () => {
  const source = `using System; using System.Text;
public sealed record Leaf(int X) { public bool Print(StringBuilder builder) => PrintMembers(builder); }
static class Program { static void Main() { Console.WriteLine(new Leaf(1).Print(new StringBuilder())); } }`;
  const result = compile(source, {});
  assert.equal(result.success, false);
  assert.ok(result.diagnostics.some(entry => entry.code === 'SF2200' && entry.message.includes('PrintMembers')));
});
