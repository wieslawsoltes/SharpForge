import test from 'node:test';
import assert from 'node:assert/strict';
import { CilError } from '@sharpforge/cil';
import { target as protocol } from '../../../scripts/conformance/fuzz/targets/protocol.js';
import { target as ilDocument } from '../../../scripts/conformance/fuzz/targets/il-document.js';
import { target as msbuildXml } from '../../../scripts/conformance/fuzz/targets/msbuild-xml.js';
import { target as network } from '../../../scripts/conformance/fuzz/targets/network.js';
import { runTextTarget } from '../../../scripts/conformance/fuzz/targets/text-contract.js';
import {
  classifyConditionError, classifyProtocolError, classifyXmlError,
} from '../../../scripts/conformance/fuzz/targets/text-errors.js';

const context = { maxInputBytes: 64 * 1024, maxOutputBytes: 256 * 1024 };
const encoder = new TextEncoder();
const encode = source => encoder.encode(source);
const json = value => encode(JSON.stringify(value));
const targets = [protocol, ilDocument, msbuildXml, network];

function seed(target, name) {
  const result = target.createSeeds().find(value => value.name === name);
  assert.ok(result, `Missing ${target.id}/${name}`);
  return result.input;
}

function framed(body) {
  return encode(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

for (const target of targets) {
  test(`${target.id}: local seeds are bounded, deterministic and independently owned`, () => {
    const first = target.createSeeds(), second = target.createSeeds();
    assert.ok(first.length > 0);
    assert.equal(new Set(first.map(value => value.name)).size, first.length);
    assert.deepEqual(first, second);
    for (let index = 0; index < first.length; index++) {
      assert.ok(first[index].input instanceof Uint8Array);
      assert.ok(first[index].input.length <= context.maxInputBytes);
      assert.notEqual(first[index].input.buffer, second[index].input.buffer);
    }
  });

  test(`${target.id}: rejects an input over the configured or hard byte ceiling`, () => {
    assert.deepEqual(target.run(new Uint8Array(9), { ...context, maxInputBytes: 8 }), {
      status: 'rejected', code: 'FUZZ_INPUT_LIMIT',
    });
    assert.deepEqual(target.run(new Uint8Array(65537), { ...context, maxInputBytes: 128 * 1024 }), {
      status: 'rejected', code: 'FUZZ_INPUT_LIMIT',
    });
  });

  test(`${target.id}: cancellation and invalid caller contracts propagate`, () => {
    const controller = new AbortController();
    const reason = new Error('Caller cancelled the fuzz case');
    controller.abort(reason);
    assert.throws(() => target.run(new Uint8Array(), { ...context, signal: controller.signal }), error => error === reason);
    assert.throws(() => target.run('', context), TypeError);
    assert.throws(() => target.run(new Uint8Array(), { ...context, maxOutputBytes: 0 }), RangeError);
  });
}

test('protocol: accepts LSP, DAP, Unicode and coalesced frames under incremental parsing', () => {
  for (const name of ['lsp-initialize', 'dap-initialize', 'unicode-result', 'coalesced-frames']) {
    assert.deepEqual(protocol.run(seed(protocol, name), context), { status: 'accepted' });
  }
  assert.deepEqual(protocol.run(framed('{"result":"ł 🐈"}'), context), { status: 'accepted' });
});

test('protocol: diagnoses malformed framing, JSON, UTF-8 and incomplete bodies', () => {
  for (const source of [
    'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}',
    'Content-Length: -1\r\n\r\n',
    'Content-Length: 2\r\n\r\n{',
    'Content-Length: 2\r\n\r\n[]',
    'Content-Length: 2\r\nContent-Type: application/json; charset=latin1\r\n\r\n{}',
  ]) assert.equal(protocol.run(encode(source), context).status, 'rejected');
  assert.deepEqual(protocol.run(framed('{x'), context), { status: 'rejected', code: 'PROTOCOL_JSON' });
  const header = encode('Content-Length: 2\r\n\r\n');
  const invalidUtf8 = new Uint8Array(header.length + 2);
  invalidUtf8.set(header);
  invalidUtf8.set([0xff, 0xff], header.length);
  assert.deepEqual(protocol.run(invalidUtf8, context), { status: 'rejected', code: 'PROTOCOL_UTF8' });
});

test('protocol: encoded messages respect the output byte budget', () => {
  assert.deepEqual(protocol.run(framed('{}'), { ...context, maxOutputBytes: 1 }), {
    status: 'rejected', code: 'FUZZ_OUTPUT_LIMIT',
  });
});

test('IL document: canonical roundtrips preserve the complete image and literals containing comment text', () => {
  for (const name of ['local-library', 'literal-comment', 'floating-negative-zero', 'floating-nan-payload']) {
    assert.deepEqual(ilDocument.run(seed(ilDocument, name), context), { status: 'accepted', code: 'IL_DOCUMENT_EXACT_ROUNDTRIP' });
  }
});

test('IL document: generated-input failures propagate outside the first assembly validation boundary', () => {
  const failure = new CilError('Generated document failed its roundtrip');
  assert.throws(() => runTextTarget(new Uint8Array(), context, () => { throw failure; }), error => error === failure);
});

test('IL document: reports syntax/scaffold failures and constrains rebuilt output', () => {
  for (const name of ['unknown-opcode', 'missing-image', 'incomplete-method']) {
    assert.deepEqual(ilDocument.run(seed(ilDocument, name), context), { status: 'rejected', code: 'IL_DOCUMENT' });
  }
  assert.deepEqual(ilDocument.run(seed(ilDocument, 'local-library'), { ...context, maxOutputBytes: 64 }), {
    status: 'rejected', code: 'FUZZ_OUTPUT_LIMIT',
  });
});

test('MSBuild XML: parses data and evaluates attributes or standalone conditions without filesystem access', () => {
  for (const name of ['minimal-project', 'conditional-project', 'entities-and-cdata', 'condition-boolean', 'condition-exists']) {
    assert.deepEqual(msbuildXml.run(seed(msbuildXml, name), context), { status: 'accepted' });
  }
  assert.deepEqual(msbuildXml.run(encode('condition:\nfalse'), context), { status: 'accepted' });
  assert.deepEqual(msbuildXml.run(encode("condition:\nExists('not-present.cs')"), context), { status: 'accepted' });
});

test('MSBuild XML: rejects malformed XML and unsupported data grammar', () => {
  for (const name of ['mismatched-tag', 'duplicate-attribute', 'doctype-denied']) {
    assert.deepEqual(msbuildXml.run(seed(msbuildXml, name), context), { status: 'rejected', code: 'MSBUILD_XML' });
  }
  assert.deepEqual(msbuildXml.run(seed(msbuildXml, 'condition-incomplete'), context), {
    status: 'rejected', code: 'MSBUILD_CONDITION',
  });
  assert.deepEqual(msbuildXml.run(encode('<Project/>'), { ...context, maxOutputBytes: 1 }), {
    status: 'rejected', code: 'FUZZ_OUTPUT_LIMIT',
  });
});

test('network: exact grants, URL normalization and request headers use pure policy APIs', () => {
  for (const name of ['allowed-origin', 'relative-url', 'allowed-headers', 'browser-csp']) {
    assert.deepEqual(network.run(seed(network, name), context), { status: 'accepted' });
  }
  assert.deepEqual(network.run(seed(network, 'denied-origin'), context), { status: 'rejected', code: 'NETWORK_DENIED' });
  assert.deepEqual(network.run(seed(network, 'non-origin-grant'), context), { status: 'rejected', code: 'NETWORK_GRANT' });
  assert.deepEqual(network.run(seed(network, 'denied-header'), context), { status: 'rejected', code: 'NETWORK_HEADER' });
});

test('network: malformed local input and output limits remain controlled failures', () => {
  const cases = [
    [json({ operation: 'headers', headers: { 'invalid name': 'value' } }), 'NETWORK_HEADER_SYNTAX'],
    [json({ operation: 'headers', headers: { Accept: 42 } }), 'NETWORK_INPUT_SCHEMA'],
    [json({ operation: 'origin', allowedOrigins: ['bad grant'], url: 'https://example.test/' }), 'NETWORK_GRANT'],
    [json({ operation: 'origin', url: 'relative' }), 'NETWORK_URL'],
    [encode('{x'), 'FUZZ_JSON'],
    [encode('[]'), 'NETWORK_INPUT_SCHEMA'],
    [Uint8Array.of(0xff), 'FUZZ_UTF8'],
  ];
  for (const [input, code] of cases) assert.deepEqual(network.run(input, context), { status: 'rejected', code });
  assert.deepEqual(network.run(seed(network, 'browser-csp'), { ...context, maxOutputBytes: 1 }), {
    status: 'rejected', code: 'FUZZ_OUTPUT_LIMIT',
  });
});

test('network: unavailable native host policy surfaces are explicitly unsupported', () => {
  for (const [operation, code] of [
    ['host-token', 'NETWORK_HOST_TOKEN_UNSUPPORTED'],
    ['host-origin', 'NETWORK_HOST_ORIGIN_UNSUPPORTED'],
    ['host-path', 'NETWORK_HOST_PATH_UNSUPPORTED'],
    ['unknown', 'NETWORK_OPERATION_UNSUPPORTED'],
  ]) assert.deepEqual(network.run(json({ operation }), context), { status: 'unsupported', code });
});

test('text targets: error classifiers preserve unexpected failures instead of counting them as rejected inputs', () => {
  const unexpected = [new TypeError('Unexpected parser state'), new RangeError('Maximum call stack size exceeded'),
    new Error('Internal invariant failed'), new SyntaxError('Unexpected adapter syntax')];
  for (const classify of [classifyProtocolError, classifyXmlError, classifyConditionError]) {
    for (const failure of unexpected) {
      assert.equal(classify(failure), null);
      assert.throws(() => runTextTarget(new Uint8Array(), context, () => { throw failure; }, classify), error => error === failure);
    }
  }
  assert.deepEqual(classifyConditionError(new Error('MSBuild property functions require the native engine')), {
    status: 'unsupported', code: 'MSBUILD_NATIVE_CONDITION',
  });
});

test('text targets: cancellation observed during a parse is not an input rejection', () => {
  const controller = new AbortController();
  const reason = new Error('Cancelled during parsing');
  assert.throws(() => runTextTarget(new Uint8Array(), { ...context, signal: controller.signal }, () => {
    controller.abort(reason);
  }), error => error === reason);
});
