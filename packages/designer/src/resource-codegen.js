import {CONTROLS, MEDIA, XAML} from '@sharpforge/framework';
import {propertySchema} from './model.js';
import {csharpValue, designerSymbol, quoteDesignerString} from './resource-codegen-values.js';

/** Compatibility is explicit: richer WinUI source is available without pretending the browser VM supports it. */
export function designCodegenDiagnostics(design, {target = 'sharpforge'} = {}) {
  const diagnostics = [];
  if (!['sharpforge', 'winui'].includes(target)) return [{code: 'SFD1871', severity: 'error', span: null, message: 'Unknown generation target.'}];
  if (target === 'winui') return diagnostics;
  const report = (feature, nodeId) => diagnostics.push({code: 'SFD1872', severity: 'error', span: null, nodeId,
    message: `${feature} is authored and previewable but requires the WinUI generation target; the SharpForge runtime contract does not expose it.`});
  if (Object.keys(design.resources ?? {}).length) report('Resource dictionaries');
  for (const node of design.nodes) {
    if (Object.keys(node.bindings ?? {}).length) report('Data bindings', node.id);
    if (Object.keys(node.resourceReferences ?? {}).length) report('Resource references', node.id);
    if (node.states?.length) report('Visual states', node.id);
    if (node.projectType) report('Project control construction', node.id);
  }
  if (Object.values(design.templates).some(template => template.states?.length)) report('Template visual states');
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.valueType === MEDIA + 'LinearGradientBrush') {
      if (!diagnostics.some(item => item.feature === 'gradient')) {
        report('LinearGradientBrush');
        diagnostics.at(-1).feature = 'gradient';
      }
      return;
    }
    for (const [key, nested] of Object.entries(value)) if (key !== 'designTime') visit(nested);
  };
  visit(design);
  return diagnostics;
}

/** Emits ordered item statements; itemName may allocate collision-free locals within the caller's source scope. */
export function generateDesignerNodeStatements(design, node, variable, {target = 'sharpforge', value = csharpValue, itemName = null} = {}) {
  const lines = [];
  for (const [property, items] of Object.entries(node.collections ?? {})) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item === null || typeof item !== 'object') lines.push(`${variable}.${property}.Add(${value(item, 'object')});`);
      else {
        const name = itemName ? itemName(node, property, index) : `item_${designerSymbol(node.id)}_${property}_${index}`;
        lines.push(`${item.type} ${name} = new ${item.type}();`);
        for (const [member, itemValue] of Object.entries(item.properties)) {
          lines.push(`${name}.${member} = ${value(itemValue, propertySchema(item.type)[member].type)};`);
        }
        lines.push(`${variable}.${property}.Add(${name});`);
      }
    }
  }
  if (target !== 'winui') return lines;
  for (const [property, reference] of Object.entries(node.resourceReferences ?? {})) {
    const type = propertySchema(node.type)[property].type;
    lines.push(`${variable}.${property} = (${type})resources[${quoteDesignerString(reference.key)}];`);
  }
  for (const [property, binding] of Object.entries(node.bindings ?? {})) {
    const values = [`Path = new ${XAML}PropertyPath(${quoteDesignerString(binding.path)})`,
      `Mode = ${XAML}Data.BindingMode.${binding.mode}`];
    if (binding.elementName) values.push('ElementName = ' + quoteDesignerString(binding.elementName));
    if (binding.converter) values.push(`Converter = (${XAML}Data.IValueConverter)resources[${quoteDesignerString(binding.converter)}]`);
    if (binding.converterParameter !== undefined) values.push('ConverterParameter = ' + value(binding.converterParameter, 'object'));
    lines.push(`${variable}.SetBinding(${node.type}.${property}Property, new ${XAML}Data.Binding() { ${values.join(', ')} });`);
  }
  return lines;
}

export function designerResourceDeclarations(design) {
  const lines = [`${XAML}ResourceDictionary resources = new ${XAML}ResourceDictionary();`];
  for (const [key, resource] of Object.entries(design.resources ?? {})) {
    const value = resource.kind === 'theme' ? resource.variants.default : resource.value;
    lines.push(`resources.Add(${quoteDesignerString(key)}, ${csharpValue(value, resource.type)});`);
  }
  return lines;
}

export function attachedDesignerAssignment(type, property, variable, value) {
  const definition = propertySchema(type)[property];
  if (!definition?.attached) return `${variable}.${property} = ${value};`;
  const owner = definition.owner ?? CONTROLS + (property.startsWith('Wrap') ? 'VariableSizedWrapGrid' :
    ['Left', 'Top', 'ZIndex'].includes(property) ? 'Canvas' : 'Grid');
  return `${owner}.Set${definition.member ?? property.replace(/^Wrap/, '')}(${variable}, ${value});`;
}
