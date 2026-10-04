import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {AnimationClock} from '@sharpforge/framework';
import {CompositionTransportHost, encodeCompositionLayers, DrawingContext, DrawOp} from '@sharpforge/rendering';
import {HostComposition} from '../packages/winui-controls/src/host/composition.js';
import {computeWorldLayout} from '../packages/winui-controls/src/layout/index.js';
import {captureVisualDisplayList} from '../packages/rendering/src/controls/capture.js';
import {layoutFixture} from './helpers/a16-layout.js';

const source = readFileSync(new URL('./fixtures/rendering/composition-preview.cs', import.meta.url), 'utf8');
let compiled;
function program() {
  if (!compiled) {
    compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  }
  return compiled;
}
const engines = {
  source: (built, options) => new VirtualMachine(built.image, options),
  reload: (built, options) => new VirtualMachine(loadAssembly(built.assembly), options),
  CIL: (built, options) => new CilVirtualMachine(built.assembly, options)
};

function paintedBrushes(list) {
  const brushes = [];
  for (const command of list.commands) {
    if (command.op === DrawOp.Rectangle) brushes.push(command.brush);
    if (command.op === DrawOp.Layer) brushes.push(...paintedBrushes(command.layer.displayList));
  }
  return brushes;
}

for (const [engine, create] of Object.entries(engines)) {
  test(engine + ': C# preview overlays retain painter order and move through the host without layout or content encoding', async () => {
    const packets = [], commands = [];
    const vm = create(program(), {virtualTime: true, onUIComposition: packet => packets.push(structuredClone(packet)),
      onUICommand: command => commands.push(command)});
    let transport;
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, 'True\nrange-rejected\n');
      const scene = vm.platform.scene(), anchor = scene.nodes.find(node => node.properties.Name === 'anchor');
      assert.ok(anchor);
      const fixture = layoutFixture(scene.nodes, {root: anchor.id, width: 100, height: 60});
      fixture.update();
      let world;
      const compositionEntries = new Map();
      const host = {nodes: fixture.nodes, elements: new Map(), context: {}, services: {}, scheduleRender() {},
        getLayout: id => world.get(id), options: {renderComposition(context, id, layer, resources) {
          if (layer) compositionEntries.set(id, {list: encodeCompositionLayers([layer]), resources});
          else compositionEntries.delete(id);
        }}};
      const projection = new HostComposition(host);
      transport = new CompositionTransportHost({clockFactory: adapter => new AnimationClock(adapter),
        setElementComposition: (id, entry) => projection.setElement(id, entry),
        onCompleted: token => vm.platform.ui.composition.complete(token)});
      for (const packet of packets) transport.receive(packet);
      const entry = projection.elements.get(anchor.id);
      assert.ok(entry?.visual && entry.child);
      const compositor = entry.visual.Compositor;
      world = computeWorldLayout(fixture.engine, {resolveNode: id => projection.resolve(id), composition: projection});
      projection.paint(anchor.id, {style: {}});
      const layoutCounts = {...fixture.engine.stats}, encodes = compositor.contentEncodes;
      assert.ok(layoutCounts.measures > 0 && layoutCounts.arranges > 0, 'The initial managed tree has completed real layout');
      assert.ok(encodes > 0, 'The overlay has produced real retained drawing content');
      const content = entry.child.Children.items.map(visual => visual.content);
      const startingBounds = {...world.get(anchor.id).bounds};
      const packetCount = packets.length, commandCount = commands.length;
      for (let frame = 1; frame <= 30; frame++) {
        compositor.advance(1000 / 60);
        world = computeWorldLayout(fixture.engine, {resolveNode: id => projection.resolve(id), composition: projection});
        projection.paint(anchor.id, {style: {}});
      }
      assert.ok(Math.abs(world.get(anchor.id).bounds.x - startingBounds.x - 10) < 1e-8);
      assert.ok(Math.abs(world.get(anchor.id).bounds.y - startingBounds.y - 5) < 1e-8);
      assert.equal(fixture.engine.stats.measures, layoutCounts.measures);
      assert.equal(fixture.engine.stats.arranges, layoutCounts.arranges);
      assert.equal(compositor.contentEncodes, encodes);
      entry.child.Children.items.forEach((visual, index) => assert.equal(visual.content, content[index]));
      assert.equal(packets.length, packetCount, 'Independent host samples emit no managed animation definitions');
      assert.equal(commands.length, commandCount, 'Independent host samples emit no managed property commands');
      assert.equal(anchor.properties.Offset, undefined);
      const background = new DrawingContext().DrawRectangle([0, 0, 100, 60], '#ffffff').finish();
      const capture = captureVisualDisplayList(host, new Map([[anchor.id, {list: background}]]), anchor.id, compositionEntries);
      const brushes = paintedBrushes(capture.list);
      assert.equal(brushes[0], '#ffffff', 'XAML content precedes its hand-in visual tree');
      assert.deepEqual(brushes.slice(1).map(brush => brush.Color), [[1, 0, 0, 1], [0, 0, 1, 1]]);
      const blue = compositor.layerFor(entry.child).children[1];
      assert.deepEqual(blue.clip.rect, [1, 2, 16, 9]);
      transport.dispose(); transport = null;
      assert.equal(projection.elements.size, 0);
      assert.equal(compositionEntries.size, 0);
    } finally { transport?.dispose(); vm.stop(); }
  });
}
