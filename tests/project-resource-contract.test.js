import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResx, writeResources, readResources, manifestResourceName, resourceEvaluationInputs, evaluateResources, normalizePath,
} from '../packages/project-system/src/index.js';

function context(files = [], items = []) {
  const diagnostics = [];
  return {
    path: 'App/App.csproj', contextId: 'fixture-context', files: new Map(files), items: { EmbeddedResource: items },
    properties: { rootnamespace: 'App' }, resolvePath: (value, base = 'App') => normalizePath(value, base),
    diagnostics, diagnostic: error => diagnostics.push(error),
  };
}

test('resx primitives produce real resources v2 records including Unicode and 64-bit values', () => {
  const xml = '<root><data name="Text"><value>  A &amp; Ω𐐀  </value></data>'
    + '<data name="Answer" type="System.Int32"><value>42</value></data>'
    + '<data name="Enabled" type="System.Boolean"><value>true</value></data>'
    + '<data name="Large" type="System.UInt64"><value>18446744073709551615</value></data>'
    + '<data name="Letter" type="System.Char"><value>Ω</value></data></root>';
  const entries = parseResx(xml);
  const bytes = writeResources(entries);
  assert.deepEqual([...bytes.slice(0, 4)], [0xce, 0xca, 0xef, 0xbe]);
  const records = new Map(readResources(bytes).map(entry => [entry.name, entry]));
  assert.equal(records.get('Text').value, '  A & Ω𐐀  ');
  assert.equal(records.get('Answer').value, 42);
  assert.equal(records.get('Enabled').value, true);
  assert.equal(records.get('Large').value, 18446744073709551615n);
  assert.equal(records.get('Letter').value, 'Ω');
  assert.deepEqual(writeResources([...entries].reverse()), bytes);
});

test('all supported binary primitive codes round-trip independently of resource name ordering', () => {
  const values = [
    ['byte', 255], ['sbyte', -128], ['int16', -32768], ['uint16', 65535],
    ['int32', -2147483648], ['uint32', 4294967295], ['int64', -9223372036854775808n],
    ['uint64', 18446744073709551615n], ['single', 1.5], ['double', Math.PI], ['bytes', new Uint8Array([0, 255, 1])],
  ];
  const entries = values.map(([type, value]) => ({ name: type, type, value }));
  const decoded = new Map(readResources(writeResources(entries)).map(entry => [entry.name, entry]));
  for (const entry of entries) assert.deepEqual(decoded.get(entry.name), entry);
});

test('resx serialized objects, invalid primitives and unsupported XML fail explicitly', () => {
  for (const body of [
    '<data name="X"><value>a</value></data><data name="X"><value>b</value></data>',
    '<data name="X" type="System.Int32"><value>2147483648</value></data>',
    '<data name="X" type="System.Int64"><value>9223372036854775808</value></data>',
    '<data name="X" type="System.Drawing.Bitmap"><value>x</value></data>',
    '<data name="X" mimetype="application/x-microsoft.net.object.binary.base64"><value>AA==</value></data>',
    '<data name="X"/>',
  ]) assert.throws(() => parseResx('<root>' + body + '</root>'), error => error.code === 'SFP1501');
  assert.throws(() => parseResx('<!DOCTYPE root><root/>'), /DTD|DOCTYPE|declaration/i);
  assert.throws(() => parseResx('<root/>', { maxLength: 2 }), /limit/i);
  assert.throws(() => parseResx('<Project/>'), error => error.code === 'SFP1501');
});

test('file references use explicit virtual content and request hydration before conversion', () => {
  const xml = '<root><data name="Content" type="System.Resources.ResXFileRef, System.Windows.Forms">'
    + '<value>assets/data.bin;System.Byte[]</value></data></root>';
  const files = new Map([['App/assets/data.bin', { bytes: new Uint8Array([0, 1, 255]) }]]);
  const options = { path: 'App/Resources.resx', readFile: path => files.get(path), resolvePath: normalizePath };
  assert.deepEqual(parseResx(xml, options), [{ name: 'Content', type: 'bytes', value: new Uint8Array([0, 1, 255]) }]);
  files.set('App/assets/data.bin', { lazy: true, size: 3 });
  assert.throws(() => parseResx(xml, options), error => {
    assert.equal(error.code, 'SFP1501');
    assert.deepEqual(error.requiredFiles, ['App/assets/data.bin']);
    return true;
  });
  files.clear();
  assert.throws(() => parseResx(xml, options), /missing/i);
  assert.throws(() => parseResx(xml), /explicit virtual file access/i);
});

test('manifest identity honors explicit names, culture and dependent-source conventions', () => {
  const item = { path: 'App/Views/Dialog.fr.resx', identity: 'Views/Dialog.fr.resx', metadata: {} };
  const project = context([['App/Views/Dialog.cs', { text: 'namespace Product.UI; partial class Dialog {}' }]]);
  assert.deepEqual(manifestResourceName(item, project), { manifestName: 'Product.UI.Dialog.fr.resources', culture: 'fr' });
  assert.deepEqual(manifestResourceName({ ...item, metadata: { LogicalName: 'Exact.Name' } }, project), {
    manifestName: 'Exact.Name', culture: 'fr',
  });
  assert.deepEqual(manifestResourceName({ ...item, metadata: { ManifestResourceName: 'Chosen' } }, project), {
    manifestName: 'Chosen.resources', culture: 'fr',
  });
  assert.deepEqual(manifestResourceName({ ...item, metadata: { WithCulture: 'false' } }, project), {
    manifestName: 'App.Views.Dialog.fr.resources', culture: '',
  });
  project.files.set('App/Views/Dialog.cs', { lazy: true, size: 30 });
  assert.throws(() => manifestResourceName(item, project), error => {
    assert.deepEqual(error.requiredFiles, ['App/Views/Dialog.cs']);
    return error.code === 'SFP1501';
  });
});

test('resource input discovery converges after resx hydration and retains context diagnostics', () => {
  const item = { path: 'App/Resources.resx', identity: 'Resources.resx', metadata: {} };
  const project = context([
    ['App/Resources.resx', { lazy: true, size: 120 }], ['App/Resources.cs', { lazy: true, size: 20 }],
    ['App/assets/data.bin', { lazy: true, size: 3 }],
  ], [item]);
  assert.deepEqual(resourceEvaluationInputs(project).paths, ['App/Resources.resx', 'App/Resources.cs']);
  project.files.set('App/Resources.resx', { text: '<root><data name="X" type="System.Resources.ResXFileRef">'
    + '<value>assets/data.bin;System.Byte[]</value></data></root>' });
  assert.deepEqual(resourceEvaluationInputs(project).paths, ['App/Resources.resx', 'App/Resources.cs', 'App/assets/data.bin']);
  project.files.set('App/Resources.resx', { text: '<root>' });
  const malformed = resourceEvaluationInputs(project);
  assert.equal(malformed.diagnostics[0].contextId, project.contextId);
  assert.equal(malformed.diagnostics[0].project, project.path);
  assert.equal(malformed.diagnostics[0].severity, 'error');
});

test('resource evaluation emits payloads and fails lazy content without empty-byte substitution', () => {
  const item = { path: 'App/Text.resx', identity: 'Text.resx', metadata: {} };
  const project = context([['App/Text.resx', { text: '<root><data name="Greeting"><value>Hello</value></data></root>' }]], [item]);
  const output = evaluateResources(project);
  assert.equal(output[0].manifestName, 'App.Text.resources');
  assert.equal(readResources(output[0].bytes)[0].value, 'Hello');
  assert.deepEqual(project.diagnostics, []);
  project.files.set(item.path, { lazy: true, size: 80 });
  assert.deepEqual(evaluateResources(project), []);
  assert.deepEqual(project.diagnostics[0].requiredFiles, [item.path]);
});

test('resource payload reader and writer reject duplicates, unsupported types and bounded/truncated input', () => {
  assert.throws(() => writeResources([{ name: 'X', value: 'a' }, { name: 'X', value: 'b' }]), /Duplicate/);
  assert.throws(() => writeResources([{ name: 'X', type: 'object', value: {} }]), /unsupported/);
  assert.throws(() => writeResources([{ name: 'X', value: 'x'.repeat(100) }], { maxBytes: 10 }), /limit/);
  assert.throws(() => writeResources(Array(20001).fill({ name: 'X', value: '' })), /count limit/);
  const bytes = writeResources([{ name: 'X', value: 'Hello' }]);
  for (const count of [0, 4, 12, bytes.length - 1]) {
    assert.throws(() => readResources(bytes.subarray(0, count)), error => error.code === 'SFP1502');
  }
  assert.throws(() => readResources(bytes, { maxBytes: 10 }), error => error.code === 'SFP1502');
});
