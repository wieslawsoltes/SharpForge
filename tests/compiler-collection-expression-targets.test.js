/**
 * SF-A02-T79: collection expression targets without a one-argument `Add` (dictionaries). The Roslyn-pinned cases are
 * in packages/compiler/test/differential/fixtures/collection-expression-targets.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const errors = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);

test('SF-A02-T79 an empty collection expression creates a dictionary; it was CS9174', () => {
  const source = `using System;
using System.Collections.Generic;
interface IMarker { }
class Program {
  static Dictionary<int, string> Make() => [];
  static void Main() {
    Dictionary<string, int> d = [];
    d.Add("a", 1);
    Console.WriteLine(d.Count + " " + Make().Count);
  }
}
`;
  assert.deepEqual(linesOf(source), ['1 0']);
});

test('SF-A02-T79 elements of a dictionary target have no Add to go through: CS9215 on the expression', () => {
  const source = `using System.Collections.Generic;
class Program {
  static void Main() {
    Dictionary<string, int> one = [new KeyValuePair<string, int>("a", 1)];
    List<int> list = [1];
    int notACollection = [];
  }
}
`;
  assert.deepEqual(errors(source), ['CS9215@[new KeyValuePair<string, int>("a", 1)]', 'CS9174@[]']);
});
