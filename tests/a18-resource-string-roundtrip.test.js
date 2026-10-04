import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesignerResourceDocument, generateDesignerResourceClass, readDesignerResourceSource,
  planDesignerResourceSourceUpdate, generateDesignResourceXaml
} from '@sharpforge/designer';

const uri = 'LiteralResources.cs';
const literal = '{Binding KeepLiteral}';
const values = [
  literal, '{}', '{}already literal', '{{nested}}', '{x:Null}', '{StaticResource Accent}',
  '', '   ', 'line one\r\n\tline two', '<tag attr="quoted">& \'apostrophe\'</tag>',
  '&amp; &#123; &unknown;', '<!DOCTYPE x [<!ENTITY external SYSTEM "https://example.invalid/secret">]>',
  '🎨 café 中文', 'ordinary text'
];

function resourceDocument(strings = values) {
  return createDesignerResourceDocument({name: 'LiteralResources',
    resources: Object.fromEntries(strings.map((value, index) => ['Text' + index, {type: 'string', value}])),
    styles: {TextStyle: {targetType: 'Button', setters: {Content: literal}}},
    templates: {Label: {targetType: 'Button', root: {
      id: 'label', type: 'TextBlock', properties: {Text: literal}, children: []
    }}}
  });
}

function read(text, extra = {}) {
  return readDesignerResourceSource(text, {uri, sources: [{uri, text, version: 7, ...extra}]});
}

test('generated x:String elements reopen literal braces, whitespace, XML text and Unicode without added escape characters', () => {
  const document = resourceDocument();
  try {
    const markup = generateDesignResourceXaml(document.value);
    assert.ok(markup.includes('<x:String x:Key="Text0">{Binding KeepLiteral}</x:String>'));
    assert.ok(markup.includes('<x:String x:Key="Text1">{}</x:String>'));
    assert.ok(markup.includes('<x:String x:Key="Text6"></x:String>'));
    assert.ok(markup.includes('&lt;!DOCTYPE'));
    assert.ok(markup.includes('&amp;amp;'));
    const text = generateDesignerResourceClass(document.value);
    const analysis = read(text);
    for (let index = 0; index < values.length; index++) {
      assert.equal(analysis.document.resources['Text' + index].type, 'string');
      assert.equal(analysis.document.resources['Text' + index].value, values[index]);
    }
    assert.equal(analysis.previewReady, true);
    assert.equal(analysis.canApply, false);
    assert.equal(analysis.compilationSucceeded, false);
    assert.ok(analysis.compilerDiagnostics.some(diagnostic => diagnostic.severity === 'error'));
    assert.equal(analysis.diagnostics[0].code, 'SFD1884');
  } finally {
    document.dispose();
  }
});

test('attribute strings still escape markup extensions and retain the literal value in style setters and template parts', () => {
  const document = resourceDocument();
  try {
    const markup = generateDesignResourceXaml(document.value);
    assert.ok(markup.includes('Property="Content" Value="{}{Binding KeepLiteral}"'));
    assert.ok(markup.includes('Text="{}{Binding KeepLiteral}"'));
    const analysis = read(generateDesignerResourceClass(document.value));
    assert.equal(analysis.document.styles.TextStyle.setters.Content, literal);
    assert.equal(analysis.document.templates.Label.root.properties.Text, literal);
  } finally {
    document.dispose();
  }
});

test('resource string candidate edits preserve the exact source boundary and reopen repeatedly without accumulating escapes', () => {
  const document = resourceDocument();
  try {
    const text = '// retain prefix\r\n' + generateDesignerResourceClass(document.value).replaceAll('\n', '\r\n') +
      '\r\nclass Keep { static string Text() { return "unchanged"; } }\r\n';
    const analysis = read(text);
    const snapshot = JSON.stringify(analysis);
    const noOp = planDesignerResourceSourceUpdate(analysis, analysis.document);
    assert.equal(noOp.noOp, true);
    assert.equal(noOp.text, text);
    assert.deepEqual(noOp.edits, []);
    const changed = structuredClone(analysis.document);
    changed.resources.Text0.value = '{}{ThemeResource StillLiteral} < > & 🎨';
    const plan = planDesignerResourceSourceUpdate(analysis, changed);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].expectedVersion, 7);
    assert.equal(plan.canApply, false);
    assert.equal(plan.compilationSucceeded, false);
    assert.equal(plan.diagnostics[0].code, 'SFD1884');
    const edit = plan.edits[0];
    assert.equal(plan.text.slice(0, edit.start), text.slice(0, edit.start));
    assert.equal(plan.text.slice(edit.start + edit.text.length), text.slice(edit.end));
    assert.equal(plan.analysis.document.resources.Text0.value, changed.resources.Text0.value);
    for (let index = 1; index < values.length; index++) {
      assert.equal(plan.analysis.document.resources['Text' + index].value, values[index]);
    }
    const reopened = read(plan.text);
    assert.equal(reopened.document.resources.Text0.value, changed.resources.Text0.value);
    assert.equal(planDesignerResourceSourceUpdate(reopened, reopened.document).text, plan.text);
    assert.equal(JSON.stringify(analysis), snapshot);
    assert.equal(analysis.sources[0].text, text);
  } finally {
    document.dispose();
  }
});

test('literal text changes retain source revision, read-only and string length boundaries', () => {
  const boundary = '{' + 'x'.repeat(99999);
  const document = resourceDocument([boundary]);
  try {
    const text = generateDesignerResourceClass(document.value);
    const analysis = read(text);
    assert.equal(analysis.document.resources.Text0.value.length, 100000);
    assert.equal(analysis.document.resources.Text0.value, boundary);
    const changed = structuredClone(analysis.document);
    changed.resources.Text0.value = '{Replacement}';
    assert.throws(() => planDesignerResourceSourceUpdate(analysis, changed, [{uri, text, version: 8}]), {code: 'SFD1882'});
    assert.throws(() => planDesignerResourceSourceUpdate(analysis, changed, [{uri, text, version: 7, readOnly: true}]), {code: 'SFD1885'});
    changed.resources.Text0.value = boundary + 'x';
    assert.throws(() => planDesignerResourceSourceUpdate(analysis, changed), {code: 'SFD1822'});
    assert.equal(analysis.sources[0].text, text);
    assert.equal(analysis.document.resources.Text0.value, boundary);
  } finally {
    document.dispose();
  }
});
