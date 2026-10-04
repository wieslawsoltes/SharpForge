import test from 'node:test';
import assert from 'node:assert/strict';
import {setDebugSources} from '../apps/studio/debug-sources.js';
import {updateDebugStopBanner} from '../apps/studio/debug-stop-banner.js';

function fixture() {
  const uri = 'sharpforge-assembly://Library/Shared.cs';
  const state = {files: [{uri: 'Shared.cs', text: 'compiled'}], frameId: 1,
    debugSettings: {breakpointsEnabled: true}, debug: {state: 'paused',
      point: {uri, line: 2, column: 3, assemblyKey: 'Library'}, reason: {reason: 'breakpoint', phase: 'before'},
      frames: [{id: 1, name: 'Library.Run', source: uri}, {id: 2, name: '<Caller>', source: uri}]}};
  setDebugSources(state, [{uri, originalUri: 'Shared.cs', assemblyKey: 'Library', text: 'compiled'}]);
  const next = {};
  const settings = {};
  let html = '';
  const banner = {hidden: true, dataset: {}, writes: 0,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; this.writes++; },
    querySelector: selector => selector === '[data-next]' ? next : settings};
  const actions = [];
  const host = {state, banner, showNext: () => actions.push('next'),
    docking: {activate: panel => actions.push(panel)}};
  return {host, state, banner, next, settings, actions};
}

test('stop banner preserves executable location, source matching and existing navigation actions', () => {
  const {host, banner, next, settings, actions} = fixture();
  updateDebugStopBanner(host);
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /sharpforge-assembly:\/\/Library\/Shared.cs:2:3/);
  assert.doesNotMatch(banner.innerHTML, /Source unavailable/);
  assert.deepEqual(banner.dataset, {reason: 'breakpoint', phase: 'before'});
  next.onclick();
  settings.onclick();
  assert.deepEqual(actions, ['next', 'debug-session']);
  updateDebugStopBanner(host);
  assert.equal(banner.writes, 1, 'An unchanged stop keeps the existing banner DOM');
});

test('caller, changed-source and muted-state explanations remain escaped and invalidate the banner cache', () => {
  const {host, state, banner} = fixture();
  updateDebugStopBanner(host);
  state.frameId = 2;
  state.files[0].text = 'edited';
  state.debugSettings.breakpointsEnabled = false;
  state.debug.reason = {reason: 'data breakpoint', description: '<write>', phase: 'after'};
  updateDebugStopBanner(host);
  assert.equal(banner.writes, 2);
  assert.match(banner.innerHTML, /After storage write/);
  assert.match(banner.innerHTML, /&lt;write&gt;/);
  assert.match(banner.innerHTML, /Inspecting caller &lt;Caller&gt;/);
  assert.match(banner.innerHTML, /Source unavailable or different/);
  assert.match(banner.innerHTML, /All breakpoints muted/);
  assert.doesNotMatch(banner.innerHTML, /<Caller>|<write>/);
});

test('running sessions hide the banner and sourceless CIL stops retain instruction navigation', () => {
  const {host, state, banner} = fixture();
  state.debug.state = 'running';
  updateDebugStopBanner(host);
  assert.equal(banner.hidden, true);
  assert.equal(banner.writes, 0);
  state.debug.state = 'paused';
  state.debug.point = null;
  state.debug.frames[0].instructionPointerReference = 'il:06000001:0002';
  state.debug.reason = {reason: 'entry', phase: 'suspended'};
  updateDebugStopBanner(host);
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /il:06000001:0002/);
  assert.match(banner.innerHTML, /Entry stop \(explicitly requested\)/);
  assert.match(banner.innerHTML, /Statement interrupted/);
});
