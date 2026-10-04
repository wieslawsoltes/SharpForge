import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildControlFlowGraph, decodeInstructions, readPE } from '@sharpforge/cil';
import { exceptionFixture } from './support/exception-encoding.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const kinds = { 0: 'catch', 1: 'filter', 2: 'finally', 4: 'fault' };

function expectedBoundary(clause, index) {
  return { clause: index, kind: kinds[clause.flags], tryStart: clause.start, tryEnd: clause.end,
    handlerStart: clause.target, handlerEnd: clause.handlerEnd, filterStart: clause.filterOffset };
}

function assertBoundaries(graph) {
  const starts = new Set(graph.blocks.map(block => block.startOffset));
  starts.add(graph.codeSize);
  for (const boundary of graph.exceptionBoundaries) {
    for (const name of ['tryStart', 'tryEnd', 'handlerStart', 'handlerEnd', 'filterStart']) {
      if (boundary[name] !== null) assert.ok(starts.has(boundary[name]), `${name}: ${boundary[name]}`);
    }
  }
}

test('A13 native CoreCLR method IL and EH observations agree with normal CFG byte extents and exception boundaries', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/decompiler-cfg/native.json', import.meta.url), 'utf8'));
  const image = Buffer.from(reference.image, 'base64');
  assert.equal(hash(image), reference.imageSha256);
  assert.equal(hash(readFileSync(new URL('./fixtures/decompiler-cfg/Program.cs', import.meta.url))), reference.sourceSha256);
  assert.equal(reference.toolchain.runtime, '10.0.5');
  assert.match(reference.native.runtime, /^\.NET 10\./);
  assert.deepEqual([reference.native.filterResult, reference.native.finallyResult, reference.native.finalizers], [44, 4, 1]);
  const pe = readPE(image, { inspection: true });
  const nativeOpcodes = JSON.parse(readFileSync(new URL('./fixtures/a03-opcodes/native.json', import.meta.url), 'utf8'));
  const descriptors = new Map(nativeOpcodes.opcodes.map(opcode => [opcode.name, opcode]));
  const observed = new Set();
  for (const method of reference.native.methods) {
    const body = pe.methodBody(method.token);
    assert.equal(Buffer.from(body.code).toString('base64'), method.code, method.name);
    const graph = buildControlFlowGraph(body.code, body.handlers);
    assert.deepEqual(graph.exceptionBoundaries, method.clauses.map(expectedBoundary), method.name);
    assertBoundaries(graph);
    const instructions = decodeInstructions(body.code);
    assert.equal(graph.instructionCount, instructions.length);
    for (const block of graph.blocks) {
      const last = instructions[block.firstInstruction + block.instructionCount - 1];
      const descriptor = descriptors.get(last.name);
      const outgoing = block.successors.map(index => graph.edges[index]);
      if (descriptor.flowControl === 'Return' || descriptor.flowControl === 'Throw') assert.equal(outgoing.length, 0, last.name);
      if (descriptor.flowControl === 'Cond_Branch') {
        assert.equal(outgoing.filter(edge => edge.kind === 'fall-through').length, 1, last.name);
      }
      for (const edge of outgoing) {
        observed.add(edge.kind);
        const targetOffset = graph.blocks[edge.target].startOffset;
        const expected = edge.kind === 'fall-through' ? last.offset + last.size
          : edge.kind === 'switch' ? last.operand[edge.caseIndex] : last.operand;
        assert.equal(targetOffset, expected, `${method.name}: ${last.offset}`);
        assert.equal(edge.clearsStack, last.name === 'leave' || last.name === 'leave.s');
      }
    }
  }
  for (const kind of ['branch', 'switch', 'fall-through', 'leave']) assert.ok(observed.has(kind), kind);
});

test('A13 retained independent SRM/CoreCLR filter and fault references keep exact clause boundaries and no invented dispatch edges', () => {
  const native = JSON.parse(readFileSync(new URL('./fixtures/eh-encoding/native.json', import.meta.url), 'utf8'));
  assert.equal(native.runtime, '.NET 10.0.5');
  for (const name of ['FilterFat', 'FaultFat']) {
    const reference = native.cases.find(value => value.id === name);
    const fixture = exceptionFixture(reference.options);
    assert.equal(hash(fixture.assembly), reference.sha256);
    assert.equal(reference.error, null);
    assert.equal(reference.result, fixture.expected);
    const graph = buildControlFlowGraph(fixture.code, fixture.handlers);
    const clauses = reference.regions.map(region => ({
      flags: Object.keys(kinds).find(key => kinds[key] === region.kind.toLowerCase()) * 1,
      start: region.tryOffset, end: region.tryOffset + region.tryLength,
      target: region.handlerOffset, handlerEnd: region.handlerOffset + region.handlerLength,
      filterOffset: region.filterOffset < 0 ? null : region.filterOffset,
    }));
    assert.deepEqual(graph.exceptionBoundaries, clauses.map(expectedBoundary));
    assertBoundaries(graph);
    for (const edge of graph.edges.filter(value => value.kind === 'leave')) assert.equal(edge.clearsStack, true);
  }
});
