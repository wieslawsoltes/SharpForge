// SF-A02-T06.1: conversion classification matches Roslyn's ClassifyConversion on the pinned corpus
// (packages/compiler/test/conversions: more than 500 source/target pairs, pinned with Roslyn by
// generate-roslyn-conversions.js). Every pair is replayed through conversions/classify.js and must agree on the
// conversion kind and on exists / isImplicit / isExplicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadPinned, corpusHash, pairCount } from '../packages/compiler/test/conversions/corpus.js';
import { replayUnit, mismatches } from '../packages/compiler/test/conversions/replay.js';
import { typePairCategories } from '../packages/compiler/test/conversions/type-pairs.js';
import { expressionPairCategories } from '../packages/compiler/test/conversions/expression-pairs.js';
import { ConversionKind } from '../packages/compiler/src/conversions/classify.js';

const corpus = loadCorpus();
const pinned = loadPinned();

test('the pinned Roslyn classifications belong to this corpus', () => {
  assert.equal(pinned.hash, corpusHash(corpus), 'pinned.json is stale: run packages/compiler/test/conversions/generate-roslyn-conversions.js');
  assert.match(pinned.roslyn, /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(pinned.compilations.length, corpus.length);
  corpus.forEach((unit, index) => {
    const expected = pinned.compilations[index];
    assert.equal(expected.typePairs.length, unit.typePairs.length);
    assert.equal(expected.expressions.length, unit.expressions.length);
    unit.typePairs.forEach((pair, at) => assert.deepEqual(expected.typePairs[at].slice(0, 2), [pair.source, pair.target]));
    unit.expressions.forEach((pair, at) => assert.deepEqual(expected.expressions[at].slice(0, 2), [pair.source, pair.target]));
  });
});

test('the corpus has at least 500 pairs and covers every required category', () => {
  assert.ok(pairCount(corpus) >= 500, `the corpus has ${pairCount(corpus)} pairs`);
  for (const [category, pairs] of Object.entries({ ...typePairCategories, ...expressionPairCategories })) {
    assert.ok(pairs.length >= 5, `category '${category}' has ${pairs.length} pairs`);
  }
  const kinds = new Set(pinned.compilations.flatMap(unit => [...unit.typePairs, ...unit.expressions].map(row => row[2])));
  const required = [
    'Identity',
    'ImplicitNumeric',
    'ExplicitNumeric',
    'ImplicitConstant',
    'ImplicitReference',
    'ExplicitReference',
    'Boxing',
    'Unboxing',
    'ImplicitNullable',
    'ExplicitNullable',
    'NullLiteral',
    'DefaultLiteral',
    'ImplicitEnumeration',
    'ExplicitEnumeration',
    'ImplicitTuple',
    'ExplicitTuple',
    'ImplicitTupleLiteral',
    'ExplicitTupleLiteral',
    'MethodGroup',
    'AnonymousFunction',
    'InterpolatedString',
    'ImplicitUserDefined',
    'ExplicitUserDefined',
    'ImplicitSpan',
    'ExplicitSpan',
    'ObjectCreation',
    'CollectionExpression',
    'NoConversion',
  ];
  for (const kind of required) {
    assert.ok(kinds.has(kind), `no pair is classified as ${kind} by Roslyn`);
    assert.ok(kind in ConversionKind, `${kind} is not a SharpForge conversion kind`);
  }
  for (const kind of kinds) assert.ok(kind in ConversionKind, `Roslyn kind ${kind} has no SharpForge counterpart`);
});

test('SharpForge binds every corpus type', () => {
  for (const unit of corpus) assert.deepEqual(replayUnit(unit).unmodelled, []);
});

test('every pair is classified as Roslyn classifies it', () => {
  const describe = row => `${row.kind} ${row.source} -> ${row.target}: Roslyn ${row.want.join(' ')}, SharpForge ${row.got.join(' ')}`;
  assert.deepEqual(mismatches(corpus, pinned).map(describe), []);
});

test('type pairs and expression pairs are replayed in corpus order with the pinned row shape', () => {
  const unit = corpus[0];
  const actual = replayUnit(unit);
  const at = (list, source, target) => unit[list].findIndex(pair => pair.source === source && pair.target === target);
  assert.deepEqual(actual.typePairs[at('typePairs', 'int', 'long')], ['ImplicitNumeric', true, true, false]);
  assert.deepEqual(actual.typePairs[at('typePairs', 'long', 'int')], ['ExplicitNumeric', true, false, true]);
  assert.deepEqual(actual.typePairs[at('typePairs', 'bool', 'int')], ['NoConversion', false, false, false]);
  assert.deepEqual(actual.typePairs[at('typePairs', 'Dog[]', 'Span<Animal>')], ['ExplicitSpan', true, false, true]);
  assert.deepEqual(actual.expressions[at('expressions', 'null', 'string')], ['ImplicitReference', true, true, false]);
  assert.deepEqual(actual.expressions[at('expressions', 'null', 'int?')], ['NullLiteral', true, true, false]);
  assert.deepEqual(actual.expressions[at('expressions', '300', 'byte')], ['ExplicitNumeric', true, false, true]);
  assert.deepEqual(actual.expressions[at('expressions', '(300, 1)', '(byte, int)')], ['ExplicitTupleLiteral', true, false, true]);
  // At C# 13 the same span pair goes through the conversion operator the span type declares.
  const csharp13 = replayUnit(corpus[1]);
  const spanPair = corpus[1].typePairs.findIndex(pair => pair.source === 'int[]' && pair.target === 'Span<int>');
  assert.deepEqual(csharp13.typePairs[spanPair], ['ImplicitUserDefined', true, true, false]);
});
