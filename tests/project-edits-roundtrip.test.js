import test from 'node:test';
import assert from 'node:assert/strict';
import {parseXmlCst, applyXmlEdits} from '../packages/project-system/src/xml-cst.js';
import {editProjectProperty, editProjectItem} from '../packages/project-system/src/project-edit/index.js';

test('A23 T09.5 one thousand seeded edit and undo pairs recover identical source bytes', () => {
  let seed = 0x239005;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const corpus = [
    '\uFEFF<Project Sdk="Microsoft.NET.Sdk">\r\n  <!-- comment -->\r\n</Project>\r\n',
    "<?xml version='1.0'?><Project><PropertyGroup><P>one&amp;two</P></PropertyGroup></Project>",
    '<Project><Choose><When Condition="true"><PropertyGroup><P>kept</P></PropertyGroup></When></Choose></Project>',
    '<Project><ItemGroup><!-- keep --><None Include="Data.txt"><M><![CDATA[a < b]]></M></None></ItemGroup></Project>',
    '<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003" />'
  ];
  for (let iteration = 0; iteration < 1000; iteration++) {
    const source = corpus[next() % corpus.length];
    const plan = next() % 2 ? editProjectProperty(source, {name: 'P' + next() % 7, value: `v<&${next()}`}) :
      editProjectItem(source, {itemType: 'PackageReference', identity: 'Package' + next() % 9, metadata: {Version: '1.2.3'}});
    parseXmlCst(plan.text);
    assert.equal(applyXmlEdits(plan.text, plan.undo), source, `seed ${seed}`);
  }
});
