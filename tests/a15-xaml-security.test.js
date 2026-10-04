import test from 'node:test';
import assert from 'node:assert/strict';
import {XamlObjectWriter, XamlParseException, readXamlNodes, parseXaml} from '@sharpforge/winui-properties';
import {xamlFixture} from './helpers/a15-resource-fixtures.js';

const presentation = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
const xaml = 'http://schemas.microsoft.com/winfx/2006/xaml';
const namespaces = `xmlns="${presentation}" xmlns:x="${xaml}"`;

test('A15 hostile XAML is rejected before any approved object constructor executes', () => {
  const cases = [
    [`<!DOCTYPE Grid SYSTEM "file:///unreadable-profile-resource"><Grid ${namespaces}/>`, 'SFXAML004'],
    [`<!DOCTYPE Grid [<!ENTITY first "x"><!ENTITY second "&first;&first;">]><Grid ${namespaces}>&second;</Grid>`, 'SFXAML004'],
    [`<Button ${namespaces} Content="&external;"/>`, 'SFXAML004'],
    [`<Grid ${namespaces} x:Class="Arbitrary.Activator"/>`, 'SFXAML046'],
    [`<Grid ${namespaces}><x:Code>throw arbitrary;</x:Code></Grid>`, 'SFXAML046'],
    [`<Grid ${namespaces} x:FactoryMethod="Execute"/>`, 'SFXAML046'],
    [`<Grid ${namespaces}><x:Arguments><x:String>payload</x:String></x:Arguments></Grid>`, 'SFXAML046'],
    [`<Grid ${namespaces}><Process xmlns="using:System.Diagnostics"/></Grid>`, 'SFXAML045'],
    [`<DataTemplate ${namespaces}><Process xmlns="using:System.Diagnostics"/></DataTemplate>`, 'SFXAML045'],
    [`<Grid ${namespaces}>${'<Grid>'.repeat(32)}${'</Grid>'.repeat(32)}</Grid>`, 'SFXAML014', {maxDepth: 16}]
  ];
  for (let index = 0; index < 64; index++) {
    cases.push([`<Grid ${namespaces}><Unregistered${index} Width="${index}"/></Grid>`, 'SFXAML045']);
  }
  for (const [source, code, limits = {}] of cases) {
    const fixture = xamlFixture();
    assert.throws(() => new XamlObjectWriter(fixture.schema).load(source, {limits}), {code});
    assert.equal(fixture.created(), 0, source);
  }
});

test('A15 XML reader enforces independent byte, node, text, attribute and name budgets', () => {
  const cases = [
    ['<Grid>' + 'x'.repeat(32) + '</Grid>', {maxBytes: 32}, 'SFXAML001'],
    ['<Grid><Grid/><Grid/><Grid/></Grid>', {maxNodes: 4}, 'SFXAML003'],
    ['<Grid>123456789</Grid>', {maxTextLength: 8}, 'SFXAML007'],
    ['<Grid A="1" B="2" C="3"/>', {maxAttributes: 2}, 'SFXAML016'],
    ['<UnregisteredLongName/>', {maxNameLength: 8}, 'SFXAML002']
  ];
  for (const [source, limits, code] of cases) assert.throws(() => readXamlNodes(source, {limits}), {code});
  const controller = new AbortController();
  controller.abort();
  const fixture = xamlFixture();
  assert.throws(() => new XamlObjectWriter(fixture.schema).load(`<Grid ${namespaces}/>`, {signal: controller.signal}),
    error => error.name === 'AbortError');
  assert.equal(fixture.created(), 0);
});

test('A15 XML namespaces, source positions, predefined entities and significant text stay intact', () => {
  const source = `<ui:Grid xmlns:ui="${presentation}" xmlns:x="${xaml}">\r\n` +
    '  <ui:TextBlock x:Name="label" Text="&lt;&amp;&#x1F600;"/>\r\n</ui:Grid>';
  const parsed = parseXaml(source);
  const text = parsed.root.children.find(child => child.kind === 'startElement');
  assert.equal(text.namespace, presentation);
  assert.equal(text.span.line, 2);
  assert.equal(text.span.column, 3);
  assert.equal(text.attributes.find(attribute => attribute.localName === 'Text').value, '<&😀');
  const fixture = xamlFixture();
  const result = new XamlObjectWriter(fixture.schema).load(source);
  assert.equal(result.namescope.findName('label').Text, '<&😀');
  result.lifetime.dispose();
});

test('A15 invalid XML namespaces and character references produce positioned diagnostics', () => {
  const cases = [
    ['<Grid xmlns:a="urn:same" xmlns:b="urn:same" a:Value="1" b:Value="2"/>', 'SFXAML010'],
    ['<a:Grid/>', 'SFXAML011'],
    ['<Grid xmlns:xml="urn:wrong"/>', 'SFXAML018'],
    ['<Grid>&#xD800;</Grid>', 'SFXAML034'],
    ['<Grid>&#0;</Grid>', 'SFXAML034'],
    ['<Grid>&amp</Grid>', 'SFXAML035'],
    ['<Grid>\n  <Button></Grid>', 'SFXAML019']
  ];
  for (const [source, code] of cases) {
    assert.throws(() => readXamlNodes(source), error => error instanceof XamlParseException && error.code === code &&
      error.lineNumber >= 1 && error.linePosition >= 1);
  }
});
