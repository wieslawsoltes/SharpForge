import {CONTROLS, XAML} from '@sharpforge/framework';
import {childSlot, propertySchema} from './model.js';
import {authoringError} from './property-diagnostics.js';
import {attachedDesignerAssignment} from './resource-codegen.js';
import {csharpValue, designerSymbol, quoteDesignerString} from './resource-codegen-values.js';

/** Emits portable profile template factories with fresh visual instances for each application. */
export function generateDesignerTemplateFactory(key, template) {
  const symbols = new Set();
  const lines = [`    static ${CONTROLS}ControlTemplate Template_${key}()`, '    {',
    `        ${CONTROLS}ControlTemplate template = new ${CONTROLS}ControlTemplate();`];
  const part = node => {
    const variable = designerSymbol(node.id);
    if (symbols.has(variable)) authoringError('SFD1873', 'Template part IDs collide after C# identifier conversion.');
    symbols.add(variable);
    lines.push(`        ${node.type} ${variable} = new ${node.type}();`);
    for (const [property, value] of Object.entries(node.properties ?? {})) {
      const definition = propertySchema(node.type)[property];
      lines.push('        ' + attachedDesignerAssignment(node.type, property, variable, csharpValue(value, definition.type)));
    }
    for (const [target, source] of Object.entries(node.bindings ?? {})) {
      lines.push(`        template.Bind(${variable}, ${quoteDesignerString(target)}, ${template.targetType}.${source}Property);`);
    }
    const children = (node.children ?? []).map(part);
    const slot = childSlot(node.type);
    for (const child of children) {
      lines.push(`        ${variable}.${slot.property}${slot.many ? `.Add(${child})` : ` = ${child}`};`);
    }
    return variable;
  };
  const root = part(template.root);
  lines.push(`        template.VisualTree = ${root};`, '        return template;', '    }');
  return lines;
}

export function generateDesignerStyles(design, {target = 'sharpforge'} = {}) {
  const lines = [];
  const visited = new Set();
  const emit = key => {
    if (visited.has(key)) return;
    const style = design.styles[key];
    if (style.basedOn) emit(style.basedOn);
    const argument = target === 'winui' ? `typeof(${style.targetType})` : quoteDesignerString(style.targetType);
    lines.push(`${XAML}Style style_${key} = new ${XAML}Style(${argument});`);
    if (style.basedOn) lines.push(`style_${key}.BasedOn = style_${style.basedOn};`);
    for (const [property, value] of Object.entries(style.setters)) {
      const type = propertySchema(style.targetType)[property].type;
      lines.push(`style_${key}.Setters.Add(new ${XAML}Setter(${style.targetType}.${property}Property, ${csharpValue(value, type)}));`);
    }
    visited.add(key);
  };
  Object.keys(design.styles).forEach(emit);
  return lines;
}
