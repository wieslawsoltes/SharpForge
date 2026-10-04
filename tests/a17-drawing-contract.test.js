import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {DisplayList, diffDisplayLists} from '../packages/rendering/src/drawing/display-list.js';
import {DrawOp, DrawingError, radii} from '../packages/rendering/src/drawing/commands.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';

const diagnostic = code => error => error instanceof DrawingError && error.code === code;
const rectangleList = (id, version, color = '#ff0000') => new DrawingContext({elementId: id, version})
  .DrawRectangle([0, 0, 10, 20], color).finish();

test('stable drawing opcodes, immutable snapshots and exact UTF-8/data round trips', () => {
  assert.deepEqual(DrawOp, {PushTransform: 1, PushClip: 2, PushOpacity: 3, Pop: 4,
    Rectangle: 16, RoundedRectangle: 17, Ellipse: 18, Line: 19, Geometry: 20, GlyphRun: 21, Image: 22, Layer: 23, Clear: 24});
  const brush = {kind: 'solid', color: [1, 0, 0, 0.5]}, drawing = new DrawingContext({elementId: 'shape-1', version: 7});
  drawing.PushTransform([1, 0, 0, 1, 2.5, 3.25]).PushClip({kind: 'rectangle', rect: [0, 0, 9, 9]})
    .PushOpacity(0.75).DrawRoundedRectangle([0, 0, 20, 10], [4, 2], brush).Pop().Pop().Pop();
  const list = drawing.finish([0, 0, 24, 14]);
  brush.color[0] = 0;
  assert.equal(list.commands[3].brush.color[0], 1);
  assert.ok(Object.isFrozen(list.commands[3].brush.color));
  assert.throws(() => { list.commands.push({op: DrawOp.Pop}); }, TypeError);
  for (const encoded of [list.serialize(), list.serialize({binary: true}), list.toData()]) {
    assert.deepEqual(DisplayList.from(encoded), list);
  }
  assert.equal(DisplayList.from(list), list);
  assert.throws(() => drawing.DrawRectangle([0, 0, 1, 1], 'blue'), diagnostic('SFRENDER007'));
});

test('wire validation rejects stack, opcode, numeric, prototype, resource and size violations', () => {
  assert.throws(() => new DrawingContext().Pop(), diagnostic('SFRENDER010'));
  assert.throws(() => new DrawingContext().PushOpacity(1).finish(), diagnostic('SFRENDER011'));
  assert.throws(() => new DrawingContext({maxCommands: 1.5}), diagnostic('SFRENDER008'));
  assert.throws(() => new DrawingContext({maxDepth: 1}).PushOpacity(1).PushOpacity(1), diagnostic('SFRENDER009'));
  assert.throws(() => new DrawingContext({maxCommands: 1}).Clear('red').Clear('blue'), diagnostic('SFRENDER008'));
  assert.throws(() => new DisplayList([{op: 65535}]), diagnostic('SFRENDER012'));
  assert.throws(() => new DisplayList([{op: DrawOp.Image, destination: [0, 0, 1, 1]}]), diagnostic('SFRENDER005'));
  assert.throws(() => new DisplayList([{op: DrawOp.Rectangle, rect: [0, 0, 1, 1], brush: {opacity: NaN}}]), diagnostic('SFRENDER016'));
  const cyclic = {}; cyclic.child = cyclic;
  assert.throws(() => new DrawingContext().DrawLayer(cyclic).finish(), diagnostic('SFRENDER016'));
  assert.throws(() => DisplayList.from({format: 2, commands: []}), diagnostic('SFRENDER015'));
  assert.throws(() => DisplayList.deserialize(new Uint8Array([0xff])), diagnostic('SFRENDER014'));
  assert.throws(() => DisplayList.deserialize('{'), diagnostic('SFRENDER014'));
  assert.throws(() => DisplayList.deserialize('{"format":1,"commands":[],"version":0,"bounds":{"__proto__":1}}'), diagnostic('SFRENDER001'));
  const unsafe = '{"format":1,"version":0,"commands":[{"op":16,"rect":[0,0,1,1],"brush":{"__proto__":{}}}]}';
  assert.throws(() => DisplayList.deserialize(unsafe), diagnostic('SFRENDER016'));
  assert.throws(() => DisplayList.deserialize(rectangleList('a', 1).serialize(), {maxBytes: 4}), diagnostic('SFRENDER013'));
  assert.throws(() => DisplayList.deserialize('{}', {maxBytes: NaN}), diagnostic('SFRENDER013'));
});

test('opaque images stay local and session handles are the explicit wire boundary', () => {
  const image = {source: {getContext() {}}, width: 1, height: 1};
  const local = new DrawingContext().DrawImage(image, [0, 0, 1, 1]).finish();
  assert.throws(() => local.serialize(), diagnostic('SFRENDER017'));
  const resources = new ResourceTable({session: 'drawing-contract'}), handle = resources.register('image', image);
  const encoded = new DrawingContext().DrawImage(handle, [0, 0, 1, 1]).finish();
  const copy = DisplayList.deserialize(encoded.serialize());
  let replay;
  copy.replay({render(list, table, options) { replay = {list, image: table.resolve(list.commands[0].image, 'image'), options}; }}, resources, {dpr: 2});
  assert.equal(replay.image, image);
  assert.equal(replay.options.dpr, 2);
  resources.dispose();
});
