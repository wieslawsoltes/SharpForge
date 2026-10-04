import { CilWriter } from '@sharpforge/cil';

/** Hand-authored IL and independently reviewed block/edge tuples; no decompiler generates the expected graphs. */
export const cfgCases = [
  { name: 'Empty', body() {}, blocks: [], edges: [], owners: [] },
  { name: 'Return', body: writer => writer.op('ret'), blocks: [[0, 1, 0, 1]], edges: [], owners: [0] },
  { name: 'Diamond', body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldc.i4.1').op('br.s', 'join');
    writer.mark('right').op('ldc.i4.2').mark('join').op('pop').op('ret');
  }, blocks: [[0, 3, 0, 2], [3, 6, 2, 2], [6, 7, 4, 1], [7, 9, 5, 2]],
  edges: [[0, 2, 'branch', null, false], [0, 1, 'fall-through', null, false],
    [1, 3, 'branch', null, false], [2, 3, 'fall-through', null, false]], owners: [0, 0, 1, 1, 2, 3, 3] },
  { name: 'LongBranches', body(writer) {
    writer.op('br', 'forward').mark('backward').op('nop').op('ret').mark('forward').op('br', 'backward');
  }, blocks: [[0, 5, 0, 1], [5, 7, 1, 2], [7, 12, 3, 1]],
  edges: [[0, 2, 'branch', null, false], [2, 1, 'branch', null, false]], owners: [0, 1, 1, 2] },
  { name: 'Loop', body(writer) {
    writer.mark('loop').op('ldc.i4.0').op('brtrue.s', 'loop').op('ret');
  }, blocks: [[0, 3, 0, 2], [3, 4, 2, 1]],
  edges: [[0, 0, 'branch', null, false], [0, 1, 'fall-through', null, false]], owners: [0, 0, 1] },
  { name: 'Switch', body(writer) {
    writer.op('ldc.i4.0').op('switch', ['first', 'first', 'third']).op('ldc.i4.0').op('pop').op('br.s', 'done');
    writer.mark('first').op('nop').op('br.s', 'done').mark('third').op('nop').mark('done').op('ret');
  }, blocks: [[0, 18, 0, 2], [18, 22, 2, 3], [22, 25, 5, 2], [25, 26, 7, 1], [26, 27, 8, 1]],
  edges: [[0, 2, 'switch', 0, false], [0, 2, 'switch', 1, false], [0, 3, 'switch', 2, false],
    [0, 1, 'fall-through', null, false], [1, 4, 'branch', null, false], [2, 4, 'branch', null, false],
    [3, 4, 'fall-through', null, false]], owners: [0, 0, 1, 1, 1, 2, 2, 3, 4] },
  { name: 'EmptySwitch', body: writer => writer.op('ldc.i4.0').op('switch', []).op('ret'),
    blocks: [[0, 6, 0, 2], [6, 7, 2, 1]], edges: [[0, 1, 'fall-through', null, false]], owners: [0, 0, 1] },
  { name: 'UnreachableInt64', body: writer => writer.op('ret').op('ldc.i8', 9223372036854775807n).op('pop').op('ret'),
    blocks: [[0, 1, 0, 1], [1, 12, 1, 3]], edges: [], owners: [0, 1, 1, 1] },
  { name: 'PrefixGroup', body(writer) {
    writer.op('ldnull').op('br.s', 'prefix').op('nop').mark('prefix').op('volatile.').op('ldind.i4').op('pop').op('ret');
  }, blocks: [[0, 3, 0, 2], [3, 4, 2, 1], [4, 9, 3, 4]],
  edges: [[0, 2, 'branch', null, false], [1, 2, 'fall-through', null, false]], owners: [0, 0, 1, 2, 2, 2, 2] },
  { name: 'Jump', body: writer => writer.op('jmp', 0x06000001).op('ret'),
    blocks: [[0, 5, 0, 1], [5, 6, 1, 1]], edges: [], owners: [0, 1] },
  { name: 'Catch', body(writer) {
    writer.mark('try').op('ldnull').op('throw').mark('handler').op('pop').op('leave.s', 'done').mark('done').op('ret');
  }, handlers: labels => [clause(labels, 0)], blocks: [[0, 2, 0, 2], [2, 5, 2, 2], [5, 6, 4, 1]],
  edges: [[1, 2, 'leave', null, true]], owners: [0, 0, 1, 1, 2], exceptions: [['catch', 0, 2, 2, 5, null]] },
  { name: 'Finally', body(writer) {
    writer.mark('try').op('leave.s', 'done').mark('handler').op('nop').op('endfinally').mark('done').op('ret');
  }, handlers: labels => [clause(labels, 2)], blocks: [[0, 2, 0, 1], [2, 4, 1, 2], [4, 5, 3, 1]],
  edges: [[0, 2, 'leave', null, true]], owners: [0, 1, 1, 2], exceptions: [['finally', 0, 2, 2, 4, null]] },
  { name: 'Fault', body(writer) {
    writer.mark('try').op('ldnull').op('throw').mark('handler').op('nop').op('endfinally').mark('done').op('ret');
  }, handlers: labels => [clause(labels, 4)], blocks: [[0, 2, 0, 2], [2, 4, 2, 2], [4, 5, 4, 1]],
  edges: [], owners: [0, 0, 1, 1, 2], exceptions: [['fault', 0, 2, 2, 4, null]] },
  { name: 'Filter', body(writer) {
    writer.mark('try').op('ldnull').op('throw').mark('filter').op('pop').op('ldc.i4.1').op('endfilter');
    writer.mark('handler').op('pop').op('leave.s', 'done').mark('done').op('ret');
  }, handlers: labels => [clause(labels, 1)], blocks: [[0, 2, 0, 2], [2, 6, 2, 3], [6, 9, 5, 2], [9, 10, 7, 1]],
  edges: [[2, 3, 'leave', null, true]], owners: [0, 0, 1, 1, 1, 2, 2, 3], exceptions: [['filter', 0, 2, 6, 9, 2]] },
  { name: 'NestedFinally', body(writer) {
    writer.op('leave.s', 'innerDone').mark('innerHandler').op('endfinally');
    writer.mark('innerDone').op('leave.s', 'done').mark('outerHandler').op('endfinally').mark('done').op('ret');
  }, handlers: labels => [
    { flags: 2, start: 0, end: labels.get('innerHandler'), target: labels.get('innerHandler'), handlerEnd: labels.get('innerDone') },
    { flags: 2, start: 0, end: labels.get('outerHandler'), target: labels.get('outerHandler'), handlerEnd: labels.get('done') },
  ], blocks: [[0, 2, 0, 1], [2, 3, 1, 1], [3, 5, 2, 1], [5, 6, 3, 1], [6, 7, 4, 1]],
  edges: [[0, 2, 'leave', null, true], [2, 4, 'leave', null, true]], owners: [0, 1, 2, 3, 4],
  exceptions: [['finally', 0, 2, 2, 3, null], ['finally', 0, 5, 5, 6, null]] },
];

function clause(labels, flags) {
  return { flags, start: labels.get('try'), end: labels.get(flags === 1 ? 'filter' : 'handler'),
    target: labels.get('handler'), handlerEnd: labels.get('done'),
    catchType: flags === 0 ? 0x01000001 : flags === 1 ? labels.get('filter') : 0 };
}

export function cfgInput(fixture) {
  const writer = new CilWriter();
  fixture.body(writer);
  return { code: writer.finish(), handlers: fixture.handlers?.(writer.labels) ?? [] };
}

export function graphTuples(graph) {
  return {
    blocks: graph.blocks.map(block => [block.startOffset, block.endOffset, block.firstInstruction, block.instructionCount]),
    edges: graph.edges.map(edge => [edge.source, edge.target, edge.kind, edge.caseIndex, edge.clearsStack]),
    owners: graph.instructionBlocks,
    exceptions: graph.exceptionBoundaries.map(value =>
      [value.kind, value.tryStart, value.tryEnd, value.handlerStart, value.handlerEnd, value.filterStart]),
  };
}

export function expectedTuples(fixture) {
  return { blocks: fixture.blocks, edges: fixture.edges, owners: fixture.owners, exceptions: fixture.exceptions ?? [] };
}
