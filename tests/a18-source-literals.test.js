import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, readDesignSource, planDesignSourceUpdate} from '@sharpforge/designer';

function source(width, content = '"Run"') {
  return `using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;
class View {
\tstatic Window Create() {
\t\tWindow window = new Window();
\t\tButton action = new Button { Width = ${width}, Content = ${content} }; // untouched 😀
\t\twindow.Content = action;
\t\treturn window;
\t}
}`;
}

for (const [literal, value, expected] of [
  ['160', 200, '200'], ['160.00', 200, '200.00'], ['0xA0', 200, '0xC8'], ['0b1010_0000', 200, '0b1100_1000'],
  ['160d', 200, '200d'], ['1_600', 2000, '2_000'], ['1.6E+2', 200, '2E+2']
]) {
  test('literal edit preserves numeric form ' + literal, () => {
    const text = source(literal);
    const analysis = readDesignSource(text);
    const document = new DesignDocument(analysis.document);
    document.setProperty('Width', value, ['action']);
    const plan = planDesignSourceUpdate(analysis, document.value);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.text, text.replace('Width = ' + literal, 'Width = ' + expected));
  });
}

for (const [literal, value, expected] of [
  ['"Run"', 'Next "quoted"', '"Next \\"quoted\\""'],
  ['@"Run"', 'Next "quoted"', '@"Next ""quoted"""'],
  ['"""Run"""', 'Next', '"""Next"""']
]) {
  test('literal edit preserves string form ' + literal, () => {
    const analysis = readDesignSource(source('160', literal));
    const document = new DesignDocument(analysis.document);
    document.setProperty('Content', value, ['action']);
    const plan = planDesignSourceUpdate(analysis, document.value);
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0].text, expected);
    assert.equal(plan.document.nodes.find(node => node.id === 'action').properties.Content, value);
  });
}

test('CRLF, comments, unicode and blank lines are unchanged outside one token', () => {
  const text = source('160').replaceAll('\n', '\r\n');
  const analysis = readDesignSource(text);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Width', 200, ['action']);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(plan.text, text.replace('Width = 160', 'Width = 200'));
});

test('generated statements inherit tabs and touch no unrelated source', () => {
  const text = source('160');
  const analysis = readDesignSource(text);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Opacity', 0.7, ['action']);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.ok(plan.text.includes('\n\t\taction.Opacity = 0.7;\n\t\treturn window;'));
  assert.ok(plan.text.includes('// untouched 😀'));
});
