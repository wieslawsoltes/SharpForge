import {portableAssertionSource} from './assertion-profile.js';
import {attributesOf, firstAttribute} from './attribute-values.js';
import {discoveryOnlyProviderSpans} from './provider-projection.js';

export function managedLiteral(value, type = null) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString() + (type === 'ulong' ? 'UL' : 'L');
  if (typeof value === 'number' && Number.isFinite(value)) return String(value) + (type === 'float' ? 'F' : type === 'double' ? 'D' : '');
  if (Array.isArray(value)) {
    const element = type?.endsWith('[]') ? type.slice(0, -2) : 'object';
    return `new ${element}[] { ${value.map(item => managedLiteral(item, element)).join(', ')} }`;
  }
  if (value?.kind === 'type' && /^[A-Za-z_][\w.<>\[\], ]*$/.test(value.name)) return `typeof(${value.name})`;
  throw new Error('Test argument cannot be represented in the portable managed profile');
}

function typeIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][\w.<> ,]*$/.test(value)) throw new Error('Unsupported test type name');
  return value;
}

function awaitCall(returnType, call) { return /(?:^|\.)Task(?:<|$)|ValueTask/.test(returnType) ? `await ${call};` : `${call};`; }

function invokeLifecycle(method, instance, className) {
  const target = method.isStatic ? className : instance;
  const args = method.parameters.map(parameter => /TestContext$/.test(parameter.type) ?
    'new Microsoft.VisualStudio.TestTools.UnitTesting.TestContext()' : 'null');
  return awaitCall(method.returnType, `${target}.${method.name}(${args.join(', ')})`);
}

function disposeLines(type, instance) {
  const async = type.methods.find(method => method.name === 'DisposeAsync' && !method.parameters.length);
  if (async) return [awaitCall(async.returnType, `${instance}.DisposeAsync()`)];
  const sync = type.methods.find(method => method.name === 'Dispose' && !method.parameters.length);
  return sync ? [`${instance}.Dispose();`] : [];
}

function fixtureType(symbols, name, owner) {
  const resolved = symbols.types.find(type => type.fqn === name || type.name === name ||
    type.fqn === owner.className.slice(0, owner.className.lastIndexOf('.') + 1) + name);
  if (!resolved) throw new Error('Fixture type is not present in the portable source profile: ' + name);
  return resolved;
}

export function portableTestSources(symbols, selectedTests = [], preserveTypes = []) {
  const selected = new Set(selectedTests.map(test => test.fqn));
  const testAttributes = new Set(['Fact', 'Theory', 'Test', 'TestCase', 'TestCaseSource', 'TestMethod', 'DataTestMethod']);
  return symbols.sources.map(source => {
    const providers = discoveryOnlyProviderSpans(symbols, source, preserveTypes);
    const removed = [...providers, ...symbols.methods.filter(method => method.source.path === source.uri && !selected.has(method.fqn) &&
      method.attributes.some(attribute => testAttributes.has(attribute.type.split('.').at(-1).replace(/Attribute$/, ''))))
      .map(method => method.declarationSpan)];
    const spans = [...removed, ...symbols.attributeSpans.filter(span => span.uri === source.uri &&
      !removed.some(parent => span.start >= parent.start && span.end <= parent.end))].sort((left, right) => right.start - left.start);
    let text = source.text;
    for (const span of spans) text = text.slice(0, span.start) + text.slice(span.start, span.end).replace(/[^\r\n]/g, ' ') + text.slice(span.end);
    return {...source, text};
  });
}

/** Compile-time harness generation calls original managed methods; outcomes come from VM returns/faults, never console parsing. */
export function createPortableTestHarness(tests, symbols) {
  const groups = new Map();
  for (const test of tests) {
    const key = test.framework + ':' + test.className + ':' + JSON.stringify(test.fixtureArguments ?? []);
    if (!groups.has(key)) groups.set(key, {key, index: groups.size, tests: [], test});
    groups.get(key).tests.push(test);
  }
  const fields = [];
  const methods = ['public static void Main() { }'];
  const suiteSetup = [];
  const suiteCleanup = [];
  const collectionFields = new Map();
  const invocation = new Map();
  const groupRecords = [];
  for (const group of groups.values()) {
    const first = group.test;
    const type = symbols.types.find(value => value.fqn === first.executionClassName);
    if (!type) throw new Error('Discovered test class is absent from the compiler symbol set');
    const className = typeIdentifier(type.fqn);
    const instance = `fixture_${group.index}`;
    const init = [];
    const cleanup = [];
    const constructorArgs = [];
    if (first.framework === 'xunit') {
      const fixtureNames = type.baseTypes.filter(value => /IClassFixture</.test(value)).map(value => value.slice(value.indexOf('<') + 1, -1));
      const collection = symbols.types.find(value => firstAttribute(value, 'CollectionDefinition')?.arguments[0] === first.collection);
      const sharedNames = collection?.baseTypes.filter(value => /ICollectionFixture</.test(value))
        .map(value => value.slice(value.indexOf('<') + 1, -1)) ?? [];
      for (const [name, shared] of [...fixtureNames.map(name => [name, false]), ...sharedNames.map(name => [name, true])]) {
        const fixture = fixtureType(symbols, name, first);
        const key = first.collection + ':' + fixture.fqn;
        let field = shared ? collectionFields.get(key) : null;
        if (!field) {
          field = `dataFixture_${fields.length}`;
          fields.push(`static ${typeIdentifier(fixture.fqn)} ${field};`);
          const setup = shared ? suiteSetup : init;
          const teardown = shared ? suiteCleanup : cleanup;
          setup.push(`${field} = new ${fixture.fqn}();`);
          const initialize = fixture.methods.find(method => method.name === 'InitializeAsync');
          if (initialize) setup.push(awaitCall(initialize.returnType, `${field}.InitializeAsync()`));
          teardown.unshift(...disposeLines(fixture, field));
          if (shared) collectionFields.set(key, field);
        }
        constructorArgs.push({type: fixture.fqn, field});
      }
    }
    const constructor = type.constructors.find(value => !value.modifiers.includes('static'));
    const construct = first.framework === 'xunit' && constructor?.parameters.length ? constructor.parameters.map(parameter => {
      const fixture = constructorArgs.find(value => value.type === parameter.type || value.type.endsWith('.' + parameter.type));
      if (!fixture) throw new Error('Test constructor parameter has no class/collection fixture: ' + parameter.type);
      return fixture.field;
    }) : (first.fixtureArguments ?? []).map(value => managedLiteral(value));
    const sharedInstance = first.framework === 'nunit';
    if (sharedInstance) {
      fields.push(`static ${className} ${instance};`);
      init.push(`${instance} = new ${className}(${construct.join(', ')});`);
    }
    for (const method of first.lifecycle.classSetup ?? []) init.push(invokeLifecycle(method, instance, className));
    for (const method of [...first.lifecycle.classTeardown ?? []].reverse()) cleanup.unshift(invokeLifecycle(method, instance, className));
    if (sharedInstance) cleanup.push(...disposeLines(type, instance));
    methods.push(`public static async System.Threading.Tasks.Task Initialize_${group.index}() { ${init.join('\n')} }`);
    methods.push(`public static async System.Threading.Tasks.Task Cleanup_${group.index}() { ${cleanup.join('\n')} }`);
    const groupRecord = {id: group.key, initialize: `Initialize_${group.index}`, cleanup: `Cleanup_${group.index}`, testIds: group.tests.map(test => test.id)};
    groupRecords.push(groupRecord);
    for (const test of group.tests) {
      const name = `Run_${invocation.size}`;
      const local = sharedInstance ? instance : 'testInstance';
      const prefix = sharedInstance || test.method.modifiers.includes('static') ? [] : [`var ${local} = new ${className}(${construct.join(', ')});`];
      const setup = (test.lifecycle.setup ?? []).map(method => invokeLifecycle(method, local, className));
      if (test.framework === 'xunit' && type.methods.some(method => method.name === 'InitializeAsync')) setup.unshift(`await ${local}.InitializeAsync();`);
      const teardown = [...test.lifecycle.teardown ?? []].reverse().map(method => invokeLifecycle(method, local, className));
      if (!sharedInstance && !test.method.modifiers.includes('static')) teardown.push(...disposeLines(type, local));
      const target = test.method.modifiers.includes('static') ? className : local;
      const args = test.arguments.map((value, index) => managedLiteral(value, test.method.parameters[index]?.type));
      const call = `${target}.${test.method.name}(${args.join(', ')})`;
      const body = test.hasExpectedResult ? `var actual = ${/Task/.test(test.method.returnType) ? 'await ' : ''}${call};
        NUnit.Framework.Assert.AreEqual(${managedLiteral(test.expectedResult)}, actual);` : awaitCall(test.method.returnType, call);
      methods.push(`public static async System.Threading.Tasks.Task ${name}() {
        ${prefix.join('\n')}
        try { ${setup.join('\n')} ${body} } finally { ${teardown.join('\n')} }
      }`);
      invocation.set(test.id, {method: name, group: groupRecord.id});
    }
  }
  methods.push(`public static async System.Threading.Tasks.Task InitializeSuite() { ${suiteSetup.join('\n')} }`);
  methods.push(`public static async System.Threading.Tasks.Task CleanupSuite() { ${suiteCleanup.join('\n')} }`);
  const source = `namespace SharpForge.Testing { public static class Entry { ${fields.join('\n')} ${methods.join('\n')} } }`;
  return {sources: [...portableTestSources(symbols, tests), {uri: 'sharpforge://testing/assertions.cs', text: portableAssertionSource()},
    {uri: 'sharpforge://testing/harness.cs', text: source}], invocation, groups: groupRecords, entryPoint: 'SharpForge.Testing.Entry.Main'};
}
