import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignSnaplines} from '@sharpforge/designer';

test('coincident numeric targets preserve each guide, edge, baseline and center rank and its first owner', () => {
  const siblings = [
    {id: 'first', bounds: {Left: -0, Top: 0, Width: 20, Height: 0}, baseline: 0},
    {id: 'second', bounds: {Left: 0, Top: -0, Width: 20, Height: 0}, baseline: 0}
  ];
  const lines = new DesignSnaplines({siblings, parent: {Width: 100, Height: 0, baseline: 0}, guides: [
    {id: 'x-first', axis: 'x', position: -0}, {id: 'x-second', axis: 'x', position: 0},
    {id: 'y-first', axis: 'y', position: 0}, {id: 'y-second', axis: 'y', position: -0}
  ]});
  assert.deepEqual(lines.lines.y.filter(line => line.position === 0).map(line => [line.kind, line.target]),
    [['guide', 'y-first'], ['edge', 'first'], ['baseline', 'first'], ['center', 'first']]);
  assert.deepEqual(lines.lines.x.filter(line => line.position === 0).map(line => [line.kind, line.target]),
    [['guide', 'x-first'], ['edge', 'first']]);
  const result = lines.snap({Left: 1, Top: 100, Width: 8, Height: 10}, {handle: 'w'});
  assert.equal(result.bounds.Left, 0);
  assert.equal(result.bounds.Width, 9);
  assert.equal(result.guides[0].target, 'x-first');
  assert.equal(result.guides[0].kind, 'guide');
});

test('negative fractional targets, explicit parent bounds and repeated guide metadata remain exact', () => {
  const lines = new DesignSnaplines({siblings: [{id: 'control', baseline: 1.25,
    bounds: {Left: -7.25, Top: 2.125, Width: 3.5, Height: 6}}],
  parent: {id: 'parent', baseline: 4, bounds: {Left: -20, Top: -10, Width: 80, Height: 60}},
  guides: [{id: 'first', axis: 'x', position: -7.25, label: 'Retain this'},
    {id: 'second', axis: 'x', position: -7.25, label: 'Duplicate'}]});
  const controlX = lines.lines.x.filter(line => line.target === 'control').map(line => [line.position, line.kind]);
  assert.deepEqual(controlX, [[-7.25, 'edge'], [-5.5, 'center'], [-3.75, 'edge']]);
  assert.equal(lines.lines.y.find(line => line.kind === 'baseline' && line.target === 'control').position, 3.375);
  assert.equal(lines.lines.y.find(line => line.kind === 'baseline' && line.target === 'parent').position, -6);
  const guide = lines.lines.x.find(line => line.kind === 'guide');
  assert.equal(guide.label, 'Retain this');
  assert.equal(guide.id, 'first');
  assert.equal(lines.snap({Left: -7, Top: 100, Width: 5, Height: 10}, {handle: 'w'}).bounds.Left, -7.25);
});

test('invalid positions are rejected before numeric target indexing can hide them', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => new DesignSnaplines({siblings: [{id: 'invalid', bounds: {Left: value, Width: 10, Height: 10}}]}));
    assert.throws(() => new DesignSnaplines({guides: [{axis: 'x', position: value}]}));
  }
});
