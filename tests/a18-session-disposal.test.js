import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, DesignerSession, DesignerSessionRegistry} from '@sharpforge/designer';

test('closing one session cancels its transaction and releases model history without changing another document', () => {
  const registry = new DesignerSessionRegistry();
  const first = registry.open('A.cs');
  const second = registry.open('B.cs');
  const document = first.document;
  document.setProperty('Width', 240, ['action']);
  document.setProperty('Width', 280, ['action']);
  document.undo();
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.redoStack.length, 1);
  const committed = document.snapshot();
  const pending = document.beginTransaction('Unfinished drag');
  pending.stage(next => { next.nodes.find(node => node.id === 'action').properties.Left = 320; });
  document.subscribe(() => {});
  const independent = second.document.beginTransaction('Independent drag');
  independent.stage(next => { next.nodes.find(node => node.id === 'action').properties.Left = 180; });

  registry.close('A.cs');

  assert.equal(document.disposed, true);
  assert.equal(document.transaction, null);
  assert.equal(document.listeners.size, 0);
  assert.equal(document.undoStack.length, 0);
  assert.equal(document.redoStack.length, 0);
  assert.equal(first.documentSubscription, null);
  assert.deepEqual(document.snapshot(), committed);
  assert.throws(() => pending.commit(), /closed/);
  assert.throws(() => document.setProperty('Width', 320, ['action']), /disposed/);
  assert.equal(second.document.disposed, false);
  independent.commit();
  assert.equal(second.document.node('action').properties.Left, 180);
  registry.dispose();
});

test('the owned model is disposed after all renderers even when a renderer cleanup fails', () => {
  const order = [];
  let modelDisposals = 0;
  class ObservedDocument extends DesignDocument {
    dispose() {
      modelDisposals++;
      order.push('document');
      super.dispose();
    }
  }
  const document = new ObservedDocument();
  const failure = new Error('Renderer cleanup failed');
  const sourceSync = {
    dispose() {
      assert.equal(document.disposed, false);
      order.push('source');
    }
  };
  const session = new DesignerSession('View.cs', {document, sourceSync});
  session.own('first renderer', () => {
    assert.equal(document.disposed, false);
    order.push('first renderer');
  });
  session.own('last renderer', () => {
    assert.equal(document.disposed, false);
    order.push('last renderer');
    throw failure;
  });
  session.subscribe(event => {
    if (event.kind === 'dispose') {
      assert.equal(document.disposed, true);
      order.push('session');
    }
  });

  assert.throws(() => session.dispose(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  assert.deepEqual(order, ['source', 'last renderer', 'first renderer', 'document', 'session']);
  assert.equal(session.resources.size, 0);
  assert.equal(session.documentSubscription, null);
  assert.equal(session.sourceSync, null);
  session.dispose();
  assert.equal(modelDisposals, 1);
});

test('replacement keeps the prior model caller owned and closing releases only the current model', () => {
  const previous = new DesignDocument();
  const current = new DesignDocument();
  const session = new DesignerSession('View.cs', {document: previous});
  session.document = current;
  assert.equal(previous.disposed, false);
  assert.equal(previous.listeners.size, 0);

  session.dispose();

  assert.equal(current.disposed, true);
  assert.equal(previous.disposed, false);
  previous.setProperty('Width', 212, ['action']);
  assert.equal(previous.node('action').properties.Width, 212);
  previous.dispose();
});

test('a model disposal failure still clears the session subscription and delivers the final lifecycle event', () => {
  const failure = new Error('Model cleanup failed');
  class FailingDocument extends DesignDocument {
    dispose() {
      super.dispose();
      throw failure;
    }
  }
  const document = new FailingDocument();
  const session = new DesignerSession('View.cs', {document});
  let closed = false;
  session.subscribe(event => { closed ||= event.kind === 'dispose'; });

  assert.throws(() => session.dispose(), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  assert.equal(document.disposed, true);
  assert.equal(session.documentSubscription, null);
  assert.equal(session.listeners.size, 0);
  assert.equal(closed, true);
  session.dispose();
});
