import test from 'node:test';
import assert from 'node:assert/strict';
import {DeferredXamlElement, NameScope, UIConstructionRoots} from '@sharpforge/winui-properties';

test('later deferred activations root construction through attachment, afterBuild and failure cleanup only', () => {
  for (const fail of [false, true]) {
    const construction = new UIConstructionRoots(), namescope = new NameScope();
    const parent = {}, root = {}, scene = [], phases = [];
    const services = {withConstruction: (action, roots) => construction.run(action, roots)};
    const context = {root, namescope, afterBuild: [], writer: {services}};
    const checkpoint = phase => {
      phases.push(phase);
      assert.equal(construction.depth, 1, phase);
      assert([...construction.roots()].includes(parent), phase + ' parent');
      assert([...construction.roots()].includes(root), phase + ' root');
    };
    const deferred = new DeferredXamlElement({name: 'part', load: false, node: {}, parent, context,
      instantiate(activation) {
        checkpoint('factory');
        const value = construction.retain({});
        activation.lifetime.add(() => {
          if (fail) checkpoint('cleanup');
        });
        activation.afterBuild.push(() => {
          checkpoint('afterBuild');
          assert([...construction.roots()].includes(value));
          if (fail) throw new Error('activation failed');
        });
        return value;
      },
      attach(value) { checkpoint('attach'); scene.push(value); },
      detach(value) { if (fail) checkpoint('detach'); scene.splice(scene.indexOf(value), 1); }
    });
    assert.equal(construction.depth, 0);
    assert.equal(construction.size, 0);
    if (fail) {
      assert.throws(() => namescope.findName('part'), /activation failed/);
      assert.deepEqual(phases, ['factory', 'attach', 'afterBuild', 'detach', 'cleanup']);
      assert.equal(scene.length, 0);
      assert.equal(deferred.scope.peek('part'), null);
    } else {
      assert.equal(namescope.findName('part'), scene[0]);
      assert.deepEqual(phases, ['factory', 'attach', 'afterBuild']);
    }
    assert.equal(construction.depth, 0);
    assert.equal(construction.size, 0);
    deferred.dispose();
    assert.equal(construction.size, 0);
  }
});
