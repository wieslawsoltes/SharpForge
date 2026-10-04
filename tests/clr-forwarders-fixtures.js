import { codedIndex } from '@sharpforge/cil';
import { managedFixture } from './managed-fixtures.js';
import { graphContext } from './clr-types-graph-fixtures.js';

const publicExports = Object.freeze([
  Object.freeze({ name: 'Widget' }),
  Object.freeze({ name: 'Outer' }),
  Object.freeze({ name: 'Inner', namespace: '', parent: 2 }),
]);

/** Independent ECMA metadata fixtures; no source profile or execution engine is involved. */
export function forwardingImage(name, target, { exports = publicExports, decorate } = {}) {
  return managedFixture({ name, entry: null, methods: [], decorate({ md }) {
    md.rows[32][0].splice(1, 4, 1, 0, 0, 0);
    const reference = md.add(35, [1, 0, 0, 0, 0, 0, md.string(target), 0, 0]);
    for (const entry of exports) {
      const implementation = entry.parent ? codedIndex('Implementation', 0x27000000 + entry.parent)
        : codedIndex('Implementation', reference);
      md.add(39, [entry.flags ?? (entry.parent ? 2 : 0x00200000), 0,
        md.string(entry.name), md.string(entry.namespace ?? 'Fixture'), implementation]);
    }
    decorate?.(md);
  } });
}

export function forwardingTarget() {
  return managedFixture({ name: 'ForwardTarget', entry: null, methods: [], decorate({ md }) {
    md.rows[32][0].splice(1, 4, 1, 0, 0, 0);
    const object = codedIndex('TypeDefOrRef', md.typeRef('System.Object'));
    md.add(2, [1, md.string('Widget'), md.string('Fixture'), object, 1, 1]);
    md.add(2, [1, md.string('Outer'), md.string('Fixture'), object, 1, 1]);
    md.add(2, [2, md.string('Inner'), 0, object, 1, 1]);
    md.add(41, [5, 4]);
  } });
}

export function forwardingConsumer() {
  return managedFixture({ name: 'ForwardConsumer', entry: null, methods: [], decorate({ md }) {
    const reference = md.add(35, [1, 0, 0, 0, 0, 0, md.string('ForwardFacade'), 0, 0]);
    const scope = codedIndex('ResolutionScope', reference);
    md.add(1, [scope, md.string('Widget'), md.string('Fixture')]);
    const outer = md.add(1, [scope, md.string('Outer'), md.string('Fixture')]);
    md.add(1, [codedIndex('ResolutionScope', outer), md.string('Inner'), 0]);
  } });
}

export function forwardingCorpus() {
  return new Map([
    ['ForwardTarget', forwardingTarget()],
    ['ForwardBridge', forwardingImage('ForwardBridge', 'ForwardTarget')],
    ['ForwardFacade', forwardingImage('ForwardFacade', 'ForwardBridge')],
    ['OuterOnly', forwardingImage('OuterOnly', 'ForwardTarget', { exports: [{ name: 'Outer' }] })],
    ['ForwardConsumer', forwardingConsumer()],
    ['CycleA', forwardingImage('CycleA', 'CycleB')],
    ['CycleB', forwardingImage('CycleB', 'CycleA')],
  ]);
}

export function forwardingContext(images = forwardingCorpus(), options = {}) {
  return graphContext({ load: request => images.get(request.assemblyName.name) ?? null, ...options });
}

export const forwardingCases = Object.freeze([
  { assembly: 'ForwardFacade', name: 'Fixture.Widget' },
  { assembly: 'ForwardFacade', name: 'Fixture.Outer' },
  { assembly: 'ForwardFacade', name: 'Fixture.Outer+Inner' },
  { assembly: 'ForwardBridge', name: 'Fixture.Widget' },
  { assembly: 'OuterOnly', name: 'Fixture.Outer+Inner' },
  { assembly: 'CycleA', name: 'Fixture.Widget' },
  { assembly: 'ForwardFacade', name: 'Fixture.Missing' },
  { assembly: 'ForwardConsumer', token: 0x01000002 },
  { assembly: 'ForwardConsumer', token: 0x01000003 },
  { assembly: 'ForwardConsumer', token: 0x01000004 },
].map(Object.freeze));
