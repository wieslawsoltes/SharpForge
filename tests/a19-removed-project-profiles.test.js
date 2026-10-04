import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '@sharpforge/project-system';
import { StudioProjects } from '../apps/studio/workbench/studio-projects.js';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { SessionRecovery } from '../apps/studio/workbench/session-recovery.js';
import { LaunchProfiles } from '../apps/studio/workbench/launch-profiles.js';
import { fakeWorkers } from './a19-session-fixtures.js';

test('deleting a project in the same workspace clears only its profiles and persists a consistent startup snapshot', () => {
  const records = [
    { path: 'Suite.slnx', text: '<Solution><Project Path="A/A.csproj" /><Project Path="B/B.csproj" /></Solution>' },
    ...['A', 'B'].flatMap(name => [
      { path: `${name}/${name}.csproj`, text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>' },
      { path: `${name}/Program.cs`, text: `Console.WriteLine("${name}");` }
    ])
  ];
  const projectSystem = new ProjectSystem(records);
  projectSystem.load('Suite.slnx');
  const files = records.filter(record => record.path.endsWith('.cs')).map(record => ({ uri: record.path, text: record.text, version: 1 }));
  const state = { projectSystem, files, name: 'Suite', startupProject: 'A/A.csproj', active: files[0].uri, langVersion: '14' };
  const services = createWorkbenchServices({ records: files, workerFactory: fakeWorkers().factory });
  const projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  services.profiles.set('A/A.csproj', { id: 'alpha', arguments: ['keep'], runtimeSettings: { compute: { workers: 4 } } });
  services.profiles.set('B/B.csproj', { id: 'beta', arguments: ['remove'] });
  services.startup.configure({ mode: 'multiple', entries: [
    { projectId: 'A/A.csproj', profile: 'alpha' }, { projectId: 'B/B.csproj', profile: 'beta' }
  ] });
  const recovery = new SessionRecovery(services);
  const snapshots = [];
  const capture = () => snapshots.push(recovery.export());
  services.startup.subscribe(capture);
  services.profiles.subscribe(capture);
  const alpha = services.profiles.get('A/A.csproj');
  projectSystem.projects.delete('B/B.csproj');
  projects.sync();
  assert.equal(services.profiles.projects.has('B/B.csproj'), false);
  assert.equal(services.profiles.selected.has('B/B.csproj'), false);
  assert.deepEqual(services.profiles.get('A/A.csproj'), alpha);
  assert.deepEqual(services.startup.entries.map(entry => entry.projectId), ['A/A.csproj']);
  assert.equal(services.builds.get('B/B.csproj'), null);
  assert(snapshots.length > 0);
  for (const snapshot of snapshots) assert.equal(JSON.stringify(snapshot).includes('B/B.csproj'), false);
  const count = snapshots.length;
  projects.sync();
  assert.equal(snapshots.length, count);
  services.dispose();
});

test('removing a virtual-default profile selection clears it without requiring a materialized profile map', () => {
  const profiles = new LaunchProfiles();
  profiles.select('Removed.csproj', 'default');
  assert.equal(profiles.projects.has('Removed.csproj'), false);
  assert.equal(profiles.removeProject('Removed.csproj'), true);
  assert.equal(profiles.selected.has('Removed.csproj'), false);
  assert.equal(profiles.removeProject('Removed.csproj'), false);
  profiles.dispose();
});
