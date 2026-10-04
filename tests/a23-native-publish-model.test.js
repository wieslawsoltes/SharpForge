import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPublishProfile, createPublishProfileRequest } from '@sharpforge/msbuild/node';

test('publish profiles are inspectable without executing conditioned properties', () => {
  const text = '<Project><PropertyGroup><PublishDir>publish/</PublishDir><PublishAot>true</PublishAot>'
    + '<RuntimeIdentifier Condition="x">linux-x64</RuntimeIdentifier></PropertyGroup></Project>';
  const profile = { name: 'Folder', ...inspectPublishProfile(text, { path: 'Properties/PublishProfiles/Folder.pubxml' }) };
  assert.equal(profile.properties.PublishAot.value, 'true');
  assert.equal(profile.properties.RuntimeIdentifier.evaluated, false);
  assert.equal(createPublishProfileRequest({ project: 'App.csproj' }, profile).properties.PublishProfile, 'Folder');
});
