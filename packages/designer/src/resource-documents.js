import {CONTROLS, XAML} from '@sharpforge/framework';
import {DesignDocument} from './model.js';
import {resourceKey} from './property-diagnostics.js';
import {quoteDesignerString} from './resource-codegen-values.js';
import {generateDesignResourceXaml} from './resource-xaml.js';

/** Resource-class documents use the same transactions and schema as visual documents. */
export function createDesignerResourceDocument({name = 'DesignerResources', resources = {}, styles = {}, templates = {}} = {}) {
  resourceKey(name);
  return new DesignDocument({version: 1, name, documentKind: 'resources', root: 'resourcePreview', width: 640, height: 480,
    nodes: [{id: 'resourcePreview', type: CONTROLS + 'Grid', properties: {}, children: [], events: {}}], resources, styles, templates});
}

export function generateDesignerResourceClass(input, {className = input.name ?? 'DesignerResources'} = {}) {
  resourceKey(className);
  const markup = generateDesignResourceXaml(input);
  return `// Generated resource dictionary for Microsoft WinUI.\npublic static class ${className}\n{\n` +
    `    public static ${XAML}ResourceDictionary Create()\n    {\n` +
    `        return (${XAML}ResourceDictionary)${XAML}Markup.XamlReader.Load(${quoteDesignerString(markup)});\n    }\n}\n`;
}
