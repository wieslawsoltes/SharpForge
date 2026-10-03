import test from 'node:test';
import assert from 'node:assert/strict';
import { Child } from '../../../scripts/conformance/acceptance/child.js';

test('owned local adapter transports JSON requests and releases its child', async () => {
  const code = `require('readline').createInterface({input:process.stdin}).on('line',line=>{
    const request=JSON.parse(line);process.stdout.write(JSON.stringify({id:request.id,result:request.args})+'\\n');
  });`;
  const child = new Child(process.execPath, ['-e', code]);
  try {
    assert.deepEqual(
      await child.request('echo', { text: 'λ' }, { timeout: 5000 }),
      { text: 'λ' },
    );
  } finally {
    await child.close();
  }
  assert.notEqual(child.child.exitCode ?? child.child.signalCode, null);
});

test('owned request timeout and cancellation terminate silent children', async () => {
  for (const cancelled of [false, true]) {
    const child = new Child(process.execPath, [
      '-e',
      'setInterval(()=>{},1000)',
    ]);
    const controller = new AbortController();
    const request = child.request(
      'wait',
      {},
      { timeout: cancelled ? 5000 : 50, signal: controller.signal },
    );
    if (cancelled) controller.abort();
    try {
      await assert.rejects(request, cancelled ? /Cancelled/ : /timed out/);
    } finally {
      await child.close();
    }
    assert.notEqual(child.child.exitCode ?? child.child.signalCode, null);
  }
});
