import test from 'node:test';
import assert from 'node:assert/strict';
import {parseXmlCst, serializeXmlCst, applyXmlEdits} from '../packages/project-system/src/xml-cst.js';
import {editProjectProperty, editProjectItem, setProjectItemMembership} from '../packages/project-system/src/project-edit/index.js';
import {applyProjectEdit} from '../packages/msbuild/src/project-edits/conflicts.js';

test('A23 T09.1 fifty unusual documents round-trip with exact BOM, quotes, comments and spans', () => {
  for (let index = 0; index < 50; index++) {
    const newline = index % 2 ? '\r\n' : '\n';
    const bom = index % 3 ? '' : '\uFEFF';
    const source = `${bom}<?xml version='1.0'?>${newline}<?build instruction?>${newline}` +
      `<m:Project xmlns:m='urn:msbuild' Sdk = "Test&amp;Sdk">${newline}<!-- case ${index} -->${newline}` +
      `<m:PropertyGroup><m:Value><![CDATA[a < b & c]]></m:Value></m:PropertyGroup>` +
      `<m:Choose><m:When Condition='&#x31; == 1'><m:ItemGroup /></m:When></m:Choose></m:Project>${newline}`;
    const tree = parseXmlCst(source);
    assert.equal(serializeXmlCst(tree), source);
    assert.equal(source.slice(tree.root.start, tree.root.openEnd).startsWith('<m:Project'), true);
    const sdk = tree.root.attributes.find(attribute => attribute.name === 'Sdk');
    assert.equal(source.slice(sdk.valueStart, sdk.valueEnd), 'Test&amp;Sdk');
    assert.equal(sdk.value, 'Test&Sdk');
    assert.equal(sdk.quote, '"');
  }
});

test('A23 T09.1 rejects malformed, external entities, bounds, stale and overlapping edits', () => {
  for (const source of ['<Project>', '<Project a="1" a="2"/>', '<!DOCTYPE P [<!ENTITY x SYSTEM "x">]><P/>',
    '<Project>&custom;</Project>', '<Project><A></Project>', '<Project/><Project/>']) assert.throws(() => parseXmlCst(source));
  assert.throws(() => parseXmlCst('<Project/>', {maxLength: 2}));
  assert.throws(() => parseXmlCst('<Project><A/></Project>', {maxNodes: 1}));
  assert.throws(() => applyXmlEdits('<Project/>', [{start: 1, end: 8, text: 'P', expected: 'Other'}]), /Stale/);
  assert.throws(() => applyXmlEdits('<Project/>', [{start: 1, end: 8, text: 'P'}, {start: 2, end: 3, text: ''}]), /Overlapping/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => parseXmlCst('<Project/>', {signal: controller.signal}), {name: 'AbortError'});
});

test('A23 T09.2 conditioned property changes exactly its value span and removes empty last group', () => {
  const source = `<Project>\n  <PropertyGroup Condition="A"><Nullable>disable</Nullable></PropertyGroup>\n` +
    `  <PropertyGroup Condition='B'><Nullable>disable</Nullable></PropertyGroup>\n` +
    `  <PropertyGroup Condition="C"><Nullable>disable</Nullable></PropertyGroup>\n</Project>`;
  const result = editProjectProperty(source, {name: 'Nullable', value: 'enable', condition: 'B'});
  assert.equal(result.edits.length, 1);
  assert.equal(result.edits[0].expected, 'disable');
  assert.equal(result.text, source.replace("Condition='B'><Nullable>disable", "Condition='B'><Nullable>enable"));
  assert.equal(applyXmlEdits(result.text, result.undo), source);
  const removed = editProjectProperty(result.text, {name: 'Nullable', value: null, condition: 'B'}).text;
  assert(!removed.includes("Condition='B'"));
  assert(removed.includes('Condition="A"'));
  assert.throws(() => editProjectProperty('<Project><PropertyGroup><P>1</P><P>2</P></PropertyGroup></Project>',
    {name: 'P', value: 3}), /Ambiguous/);
});

test('A23 T09.3 coalesces packages, updates quoted metadata, preserves comments and toggles glob exclusion', () => {
  const source = '<Project>\r\n  <!-- keep -->\r\n  <ItemGroup>\r\n' +
    "    <PackageReference Include='A' Version = '1&amp;2' />\r\n  </ItemGroup>\r\n</Project>";
  const changed = editProjectItem(source, {itemType: 'PackageReference', identity: 'A', metadata: {Version: '3&4'}});
  assert.equal(changed.edits.length, 1);
  assert(changed.text.includes("Version = '3&amp;4'"));
  const added = editProjectItem(changed.text, {itemType: 'PackageReference', identity: 'B', metadata: {Version: '1.0'}}).text;
  assert.equal((added.match(/<ItemGroup>/g) ?? []).length, 1);
  assert(added.includes('<!-- keep -->'));
  const original = '<Project Sdk="Microsoft.NET.Sdk">\n</Project>';
  let toggled = original;
  for (let index = 0; index < 10; index++) {
    toggled = setProjectItemMembership(toggled, {identity: 'File.cs', include: false, implicit: true});
    assert.equal((toggled.match(/Remove="File.cs"/g) ?? []).length, 1);
    toggled = setProjectItemMembership(toggled, {identity: 'File.cs', include: true, implicit: true});
    assert.equal(toggled, original);
  }
});

test('A23 T09.4 conflicts expose the three versions and hashes without a partial write', async () => {
  let writes = 0;
  const workspace = {read: async () => ({hash: 'remote', text: '<Project><!--remote--></Project>'}),
    save: async () => { writes++; return {written: [{hash: 'next'}]}; }};
  const request = {path: 'A.csproj', expectedHash: 'base', baseText: '<Project/>', text: '<Project><P/></Project>'};
  const result = await applyProjectEdit(workspace, request);
  assert.equal(result.applied, false);
  assert.equal(result.expectedHash, 'base');
  assert.equal(result.actualHash, 'remote');
  assert.deepEqual(result.conflict, {base: request.baseText, local: request.text, remote: '<Project><!--remote--></Project>'});
  assert.equal(writes, 0);
  workspace.read = async () => ({hash: 'base', text: request.baseText});
  assert.equal((await applyProjectEdit(workspace, request)).applied, true);
  assert.equal(writes, 1);
});
