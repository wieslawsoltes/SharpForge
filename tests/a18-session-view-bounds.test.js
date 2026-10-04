import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSession, DesignerSessionRegistry, normalizeDesignerViewState} from '@sharpforge/designer';

test('session state preserves the surface zoom and guide grid ranges with finite bounds', () => {
  const session = new DesignerSession('View.cs');
  for (const zoom of [.1, 5, 6.75, 8]) {
    session.zoom = zoom;
    assert.equal(session.zoom, zoom);
  }
  for (const snap of [.25, .5, 128, 1024]) {
    session.snap = snap;
    assert.equal(session.snap, snap);
  }
  session.setViewState({zoom: 100, snap: 2048});
  assert.equal(session.zoom, 8);
  assert.equal(session.snap, 1024);
  session.setViewState({zoom: 0, snap: 0});
  assert.equal(session.zoom, .1);
  assert.equal(session.snap, .25);
  assert.equal(session.document.revision, 0);
  assert.equal(session.document.undoStack.length, 0);
  session.dispose();
});

test('invalid zoom and snap recovery values use safe defaults instead of nonfinite layout state', () => {
  for (const invalid of [Infinity, -Infinity, Number.NaN, '8', null]) {
    const recovered = normalizeDesignerViewState({zoom: invalid, snap: invalid});
    assert.equal(recovered.zoom, .8);
    assert.equal(recovered.snap, 8);
  }
});

test('recovered inactive documents retain 800 percent zoom and fractional or large guide spacing', () => {
  const original = new DesignerSessionRegistry();
  const first = original.open('A.cs');
  const second = original.open('B.cs');
  first.setViewState({zoom: 8, snap: .25});
  second.setViewState({zoom: 5, snap: 1024});
  original.activate('A.cs');
  const saved = JSON.parse(JSON.stringify(original.snapshot()));
  original.dispose();
  const recovered = new DesignerSessionRegistry();
  recovered.restore(saved, {files: ['A.cs', 'B.cs']});
  assert.equal(recovered.open('A.cs').zoom, 8);
  assert.equal(recovered.get('A.cs').snap, .25);
  assert.equal(recovered.open('B.cs').zoom, 5);
  assert.equal(recovered.get('B.cs').snap, 1024);
  recovered.dispose();
});
