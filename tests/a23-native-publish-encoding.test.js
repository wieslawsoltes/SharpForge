import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMSBuildHost } from '@sharpforge/msbuild/node';
import { MSBuildClient } from '@sharpforge/msbuild';

test('A23 native HTTP profile discovery uses bounded shared text decoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-native-publish-encoding-'));
  const directory = join(root, 'App/Properties/PublishProfiles');
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, 'App/App.csproj'), '<Project />');
  const text = '<Project><PropertyGroup><PublishDir>output/é/</PublishDir></PropertyGroup></Project>';
  await writeFile(join(directory, 'Little.pubxml'), Buffer.from(text, 'utf16le'));
  await writeFile(join(directory, 'Big.pubxml'), Buffer.concat([Buffer.from([254, 255]), Buffer.from(text, 'utf16le').swap16()]));
  const host = await startMSBuildHost({ root, port: 0 });
  const client = new MSBuildClient({ token: host.token, fetch: (path, options) => fetch(new URL(path, host.origin), options) });
  try {
    const profiles = await client.publishProfiles({ project: 'App/App.csproj' });
    assert.deepEqual(profiles.map(profile => profile.name), ['Big', 'Little']);
    for (const profile of profiles) {
      assert.equal(profile.properties.PublishDir.value, 'output/é/');
      assert.equal(profile.properties.PublishDir.evaluated, true);
      assert.equal(profile.inspectionOnly, true);
    }
    await writeFile(join(directory, 'Binary.pubxml'), Uint8Array.of(1, 2, 3, 4));
    await assert.rejects(client.publishProfiles({ project: 'App/App.csproj' }), /Binary files are not editable text/);
    await rm(join(directory, 'Binary.pubxml'));
    host.workspace.maxTextBytes = 4;
    await assert.rejects(client.publishProfiles({ project: 'App/App.csproj' }), /Text file size limit exceeded/);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
