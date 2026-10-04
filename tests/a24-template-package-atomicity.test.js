import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '@sharpforge/archive';
import { TemplateCatalog, installTemplatePackage, searchTemplates } from '@sharpforge/templates';

function templatePackage(identities) {
  const records = identities.flatMap((identity, index) => {
    const prefix = 'content/' + String(index).padStart(2, '0') + '/';
    const config = {
      identity, name: identity, shortName: 'atomic-' + index,
      postActions: [{ actionId: 'manual-fixture', description: 'Inspect the generated project.' }]
    };
    return [
      { path: prefix + '.template.config/template.json', text: JSON.stringify(config) },
      { path: prefix + 'Sample.csproj', text: '<Project Sdk="Microsoft.NET.Sdk" />' }
    ];
  });
  return writeZip(records);
}

function existingCatalog() {
  return new TemplateCatalog([{ id: 'Existing.Template', kind: 'project', name: 'Existing template' }]);
}

test('a later invalid package identity leaves the caller catalog completely unchanged', () => {
  const catalog = existingCatalog();
  const before = catalog.list({ kind: 'all' });
  const originalMap = catalog.templates;
  const bytes = templatePackage(['Valid.Template', 'Invalid Template']);

  assert.throws(() => installTemplatePackage(bytes, { catalog }), {
    code: 'SFTPL004', message: 'Invalid template identity'
  });
  assert.deepEqual(catalog.list({ kind: 'all' }), before);
  assert.equal(catalog.templates, originalMap);
  assert.equal(catalog.get('Existing.Template'), before[0]);
  assert.equal(catalog.get('Valid.Template'), undefined);
  assert.equal(catalog.get('Invalid Template'), undefined);
});

test('a later identity collision also preserves the original catalog and its record identities', () => {
  const catalog = existingCatalog();
  const before = catalog.list({ kind: 'all' });
  const bytes = templatePackage(['Valid.Template', 'Existing.Template']);

  assert.throws(() => installTemplatePackage(bytes, { catalog }), {
    code: 'SFTPL004', message: 'Template already installed: Existing.Template'
  });
  assert.deepEqual(catalog.list({ kind: 'all' }), before);
  assert.equal(catalog.get('Existing.Template'), before[0]);
  assert.equal(catalog.get('Valid.Template'), undefined);
});

test('a validated package installs every template into the same catalog and exposes manual actions', () => {
  const catalog = existingCatalog();
  const existing = catalog.get('Existing.Template');
  const installed = installTemplatePackage(templatePackage(['First.Template', 'Second.Template']), { catalog });

  assert.equal(installed.catalog, catalog);
  assert.equal(catalog.get('Existing.Template'), existing);
  assert.deepEqual(installed.templates.map(template => template.id), ['First.Template', 'Second.Template']);
  assert.equal(catalog.list({ kind: 'all' }).length, 3);
  assert.deepEqual(searchTemplates({ catalog, query: 'atomic-1' }).map(template => template.id), ['Second.Template']);
  assert.deepEqual(installed.postActions.map(action => [action.template, action.manual]), [
    ['First.Template', true], ['Second.Template', true]
  ]);
});
