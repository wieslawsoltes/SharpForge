import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractNative,bclMetadata,winuiMetadata,diagnosticMetadata } from '../../../scripts/conformance/inventory/native-metadata.js';
import { bclApiDiff } from '../../../scripts/conformance/inventory/bcl-api-diff.js';
import { winuiApiDiff } from '../../../scripts/conformance/inventory/winui-api-diff.js';
import { resolveToolchain } from '../../../scripts/conformance/oracle/toolchain.js';

const toolchain=await resolveToolchain();
test('real pinned reference pack yields public metadata across all 167 assemblies',async()=>{
  const reference=await bclMetadata({toolchain});assert.equal(reference.files.length,167);assert.ok(reference.rows.length>40000);
  assert.ok(reference.rows.some(r=>r.owner==='System.GC'&&r.name==='Collect'));
  const result=bclApiDiff(reference);assert.equal(result.rows.length,reference.rows.length);assert.ok(result.rows.some(r=>r.status==='missing'));
  assert.ok(reference.files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));
});
test('actual restored pinned WinMD contains native Button properties and events',async()=>{
  const reference=await winuiMetadata({toolchain});assert.ok(reference.rows.some(r=>r.owner==='Microsoft.UI.Xaml.Controls.Button'));
  assert.ok(reference.rows.some(r=>r.kind==='event'&&r.name==='Click'));
  const result=winuiApiDiff(reference);assert.equal(result.rows.length,reference.rows.length);assert.ok(result.controls.length>100);
});
test('real Roslyn ErrorCode enumeration includes compile errors and warnings',async()=>{
  const result=await diagnosticMetadata({toolchain});assert.ok(result.rows.length>1000);assert.ok(result.rows.some(r=>r.name==='ERR_SemicolonExpected'&&r.value===1002));assert.ok(result.rows.some(r=>r.name.startsWith('WRN_')));
});
test('native extractor rejects malformed PE, empty inputs, invalid mode and cancellation',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'sf-native-negative-')),file=path.join(dir,'bad.dll');
  try {
    await writeFile(file,Buffer.from([0x4d,0x5a,0,0]));
    await assert.rejects(extractNative('metadata',[file],{toolchain}),/BadImage|metadata|image/i);
    await assert.rejects(extractNative('metadata',[],{toolchain}),/input count/i);
    await assert.rejects(extractNative('bad-mode',[],{toolchain}),/Unknown/);
    const controller=new AbortController();controller.abort();await assert.rejects(extractNative('ecma',[],{toolchain,signal:controller.signal}),/cancel|abort/i);
  }finally{await rm(dir,{recursive:true,force:true});}
});
