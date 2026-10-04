import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNativeTool} from '../apps/studio/native-build/tool-renderer.js';

test('native tool rendering delegates the supported panel and exact host element', () => {
  for (const panel of ['msbuild', 'msbuild-inspector', 'project-source', 'tests']) {
    const element = {};
    let rendered;
    const nativeBuild = {render(...args) { assert.equal(this, nativeBuild); rendered = args; }};
    assert.equal(renderNativeTool(panel, element, {state: {}, nativeBuild}), true);
    assert.deepEqual(rendered, [panel, element]);
  }
});

test('unrelated and portable project tools retain their existing render paths', () => {
  const element = {innerHTML: 'retained'};
  assert.equal(renderNativeTool('unrelated', element, {state: {}}), false);
  assert.equal(renderNativeTool('project', element, {state: {nativeMode: false}}), false);
  assert.equal(element.innerHTML, 'retained');
});

test('native project summary escapes the workspace root and offers existing command hooks', () => {
  const element = {};
  assert.equal(renderNativeTool('project', element,
    {state: {nativeMode: true, nativeWorkspace: {root: '<unsafe>& workspace'}}}), true);
  assert.match(element.innerHTML, /&lt;unsafe&gt;&amp; workspace/);
  assert.doesNotMatch(element.innerHTML, /<unsafe>/);
  for (const command of ['nativeMSBuild', 'nativeEvaluate', 'tool:project-source', 'tool:tests']) {
    assert.ok(element.innerHTML.includes('data-command="' + command + '"'));
  }
});
