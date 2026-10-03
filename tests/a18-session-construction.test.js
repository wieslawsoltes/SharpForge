import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSession} from '@sharpforge/designer';
import {DesignerDocuments} from '../apps/studio/designer-documents.js';
import {DesignerDocumentView} from '../apps/studio/designer-document-view.js';
import {DesignerAccessibility} from '../apps/studio/designer-accessibility.js';
import {DesignerSourceSync} from '../apps/studio/designer-source-sync.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

function sourceRoot() {
  const fixture = sessionDom();
  const element = fixture.document.createElement('section');
  const input = fixture.document.createElement('textarea');
  input.value = 'User source and editor state';
  element.append(input);
  return {...fixture, element, input};
}

test('failed tools initialization retains its original error while the registry releases its model and resources', () => {
  const {element, input, observers} = sourceRoot();
  const original = new TypeError('Missing initialization dependency');
  const cleanup = new Error('Renderer cleanup also failed');
  let ownedModel;
  let cleanups = 0;
  const documents = new DesignerDocuments({
    state: {active: 'View.cs', files: [{uri: 'View.cs', text: 'class View { static Window Create() { return new Window(); } }'}]},
    createTools: session => {
      ownedModel = session.document;
      return {ensure() { throw original; }, dispose() { cleanups++; throw cleanup; }};
    }
  });

  assert.throws(() => documents.wrap('View.cs', element, {}), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, original.message);
    assert.equal(error.cause, original);
    assert.equal(error.errors[0], original);
    assert.deepEqual(error.errors[1].errors, [cleanup]);
    return true;
  });
  assert.equal(documents.registry.get('View.cs'), null);
  assert.equal(documents.views.size, 0);
  assert.equal(ownedModel.disposed, true);
  assert.equal(cleanups, 1);
  assert.deepEqual(element.childNodes, [input]);
  assert.equal(input.value, 'User source and editor state');
  assert.equal(element.classList.contains('designer-document'), false);
  assert.ok(observers.every(observer => observer.disconnected));
  documents.dispose();
  assert.equal(cleanups, 1);
});

test('a successful construction cleanup rethrows the same original object and preserves the existing editor', () => {
  const {element, input} = sourceRoot();
  const session = new DesignerSession('View.cs');
  const original = new Error('Tools construction failed');

  assert.throws(() => new DesignerDocumentView({session, element, editor: {}, createTools: () => { throw original; }}),
    error => error === original);
  assert.deepEqual(element.childNodes, [input]);
  assert.equal(session.listeners.size, 0);
  session.dispose();
});

test('view cleanup failure retains the construction cause and still restores source identity and remaining listeners', () => {
  const {element, input, observers} = sourceRoot();
  const session = new DesignerSession('View.cs');
  const original = new Error('Surface initialization failed');
  const cleanup = new Error('Resize observer cleanup failed');
  let view;
  const createTools = (_session, options) => {
    view = options.documentHost;
    observers[0].disconnect = () => { throw cleanup; };
    return {ensure() { throw original; }, dispose() {}};
  };

  assert.throws(() => new DesignerDocumentView({session, element, editor: {}, createTools}), error => {
    assert.equal(error.message, original.message);
    assert.equal(error.cause, original);
    assert.deepEqual(error.errors[1].errors, [cleanup]);
    return true;
  });
  assert.equal(view.disposed, true);
  assert.equal(view.unsubscribe, null);
  assert.equal(view.cleanup.length, 0);
  assert.equal(session.listeners.size, 0);
  assert.deepEqual(element.childNodes, [input]);
  assert.ok([...element.listeners.values()].every(listeners => listeners.length === 0));
  assert.equal(element.dataset.designerDocument, undefined);
  assert.equal(element.dataset.designerMode, undefined);
  view.dispose();
  session.dispose();
});

test('an early controller construction failure disposes source synchronization without mounting accessibility DOM', () => {
  const {element, input} = sourceRoot();
  const original = new TypeError('Geometry cannot read an unmounted scroller');
  let source;
  let accessibility;
  let ownedModel;
  const documents = new DesignerDocuments({
    state: {active: 'View.cs', files: [{uri: 'View.cs', text: 'class View { static Window Create() { return new Window(); } }'}]},
    createTools: session => {
      ownedModel = session.document;
      const view = {
        session, document: ownedModel, chrome: {renderSync() {}},
        panel() { throw new Error('An unmounted controller must not request DOM'); }
      };
      accessibility = view.accessibility = new DesignerAccessibility(view);
      source = session.sourceSync = new DesignerSourceSync(view);
      accessibility.announce('Source status before surface mount');
      accessibility.update({kind: 'initialize'});
      source.report('blocked', original.message, []);
      throw original;
    }
  });

  assert.throws(() => documents.wrap('View.cs', element, {}), error => error === original);
  assert.equal(source.disposed, true);
  assert.equal(ownedModel.disposed, true);
  assert.equal(accessibility.region, null);
  assert.equal(accessibility.announcements, undefined);
  assert.deepEqual(element.childNodes, [input]);
  assert.equal(documents.registry.size, 0);
  documents.dispose();
});
