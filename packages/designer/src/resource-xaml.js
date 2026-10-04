import {CONTROLS, MEDIA, XAML, frameworkType} from '@sharpforge/framework';
import {childSlot, propertySchema, validateDesign} from './model.js';
import {authoringError} from './property-diagnostics.js';
import {designerColorHex} from './property-values.js';
import {designerSymbol, quoteDesignerString} from './resource-codegen-values.js';

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const presentation = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
const xamlNamespace = 'http://schemas.microsoft.com/winfx/2006/xaml';
const short = type => type.split('.').at(-1);

function valueText(value, type) {
  if (value === null) return '{x:Null}';
  if (typeof value !== 'object') {
    const enumeration = frameworkType(type);
    if (enumeration?.kind === 'enum') return Object.entries(enumeration.values).find(([, item]) => item === value)?.[0];
    return String(value).startsWith('{') ? '{}' + value : String(value);
  }
  if (value.Color) return designerColorHex(value.Color);
  if (value.GridUnitType !== undefined) return value.GridUnitType === 0 ? 'Auto' :
    value.GridUnitType === 2 ? `${value.Value === 1 ? '' : value.Value}*` : String(value.Value);
  const fields = value.Left !== undefined ? ['Left', 'Top', 'Right', 'Bottom'] :
    value.TopLeft !== undefined ? ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] : null;
  if (fields) return fields.map(key => value[key]).join(',');
  return null;
}

function valueElement(value, type, key = '') {
  const keyText = key ? ` x:Key="${xml(key)}"` : '';
  if (value?.valueType === MEDIA + 'LinearGradientBrush') {
    const start = value.StartPoint;
    const end = value.EndPoint;
    return `<LinearGradientBrush${keyText} StartPoint="${start.X},${start.Y}" EndPoint="${end.X},${end.Y}" Opacity="${value.Opacity}">` +
      value.GradientStops.map(stop => `<GradientStop Color="${designerColorHex(stop.Color)}" Offset="${stop.Offset}"/>`).join('') +
      '</LinearGradientBrush>';
  }
  if (value?.Color) return `<SolidColorBrush${keyText} Color="${designerColorHex(value.Color)}" Opacity="${value.Opacity ?? 1}"/>`;
  const primitive = {string: 'x:String', bool: 'x:Boolean', int: 'x:Int32', double: 'x:Double'}[type];
  const name = primitive ?? short(type);
  // Markup-extension escaping applies to attributes, not the literal text of an x:String element.
  const text = type === 'string' ? value : valueText(value, type);
  if (text === null || text === undefined) authoringError('SFD1874', `Cannot serialize ${type} to WinUI XAML.`);
  return `<${name}${keyText}>${xml(text)}</${name}>`;
}

function setterXml(property, value, type, target = '') {
  const address = target ? `Target="${xml(target + '.' + property)}"` : `Property="${xml(property)}"`;
  const text = value?.GradientStops || value?.Opacity !== undefined && value?.Color ? null : valueText(value, type);
  return text === null ? `<Setter ${address}><Setter.Value>${valueElement(value, type)}</Setter.Value></Setter>` :
    `<Setter ${address} Value="${xml(text)}"/>`;
}

function stateGroupsXml(groups, nodes, names) {
  if (!groups?.length) return '';
  return '<VisualStateManager.VisualStateGroups>' + groups.map(group => {
    const states = group.states.map(state => `<VisualState x:Name="${xml(state.name)}"><VisualState.Setters>` +
      state.setters.map(setter => setterXml(setter.property, setter.value,
        propertySchema(nodes.get(setter.target).type)[setter.property].type, names.get(setter.target))).join('') +
      '</VisualState.Setters></VisualState>').join('');
    const transitions = (group.transitions ?? []).map(transition => {
      const seconds = transition.duration / 1000;
      const duration = `0:${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3)}`;
      return `<VisualTransition${transition.from ? ` From="${xml(transition.from)}"` : ''}` +
        `${transition.to ? ` To="${xml(transition.to)}"` : ''} GeneratedDuration="${duration}"/>`;
    }).join('');
    return `<VisualStateGroup x:Name="${xml(group.name)}"><VisualStateGroup.Transitions>${transitions}` +
      `</VisualStateGroup.Transitions>${states}</VisualStateGroup>`;
  }).join('') + '</VisualStateManager.VisualStateGroups>';
}

function bindingXml(typeName, property, binding) {
  const attributes = [`Path="${xml(binding.path)}"`, `Mode="${xml(binding.mode)}"`];
  if (binding.elementName) attributes.push(`ElementName="${xml(binding.elementName)}"`);
  if (binding.converter) attributes.push(`Converter="{StaticResource ${xml(binding.converter)}}"`);
  if (binding.converterParameter !== undefined) attributes.push(`ConverterParameter="${xml(valueText(binding.converterParameter, 'string'))}"`);
  return `<${typeName}.${property}><Binding ${attributes.join(' ')}/></${typeName}.${property}>`;
}

function resourceXml(design, emitTemplate) {
  const values = [];
  for (const [key, resource] of Object.entries(design.resources ?? {})) {
    if (resource.kind !== 'theme') values.push(valueElement(resource.value, resource.type, key));
  }
  const themed = Object.entries(design.resources ?? {}).filter(([, resource]) => resource.kind === 'theme');
  if (themed.length) {
    const themes = [['default', 'Default'], ['light', 'Light'], ['dark', 'Dark'], ['highContrast', 'HighContrast']];
    values.push('<ResourceDictionary.ThemeDictionaries>' + themes.map(([id, name]) => `<ResourceDictionary x:Key="${name}">` +
      themed.map(([key, resource]) => valueElement(resource.variants[id] ?? resource.variants.default, resource.type, key)).join('') +
      '</ResourceDictionary>').join('') + '</ResourceDictionary.ThemeDictionaries>');
  }
  const completed = new Set();
  const style = key => {
    if (completed.has(key)) return;
    const value = design.styles[key];
    if (value.basedOn) style(value.basedOn);
    const basedOn = value.basedOn ? ` BasedOn="{StaticResource ${xml(value.basedOn)}}"` : '';
    values.push(`<Style x:Key="${xml(key)}" TargetType="${short(value.targetType)}"${basedOn}>` +
      Object.entries(value.setters).map(([property, item]) => setterXml(property, item,
        propertySchema(value.targetType)[property].type)).join('') + '</Style>');
    if (value.implicit) values.push(`<Style TargetType="${short(value.targetType)}" BasedOn="{StaticResource ${xml(key)}}"/>`);
    completed.add(key);
  };
  Object.keys(design.styles).forEach(style);
  for (const [key, template] of Object.entries(design.templates)) values.push(emitTemplate(key, template));
  return values.length ? '<ResourceDictionary>' + values.join('') + '</ResourceDictionary>' : '';
}

/** Rich resources, theme references and visual states use the public WinUI XAML loader semantics. */
export function generateDesignXaml(input, {resourcesOnly = false} = {}) {
  const design = validateDesign(input);
  const byId = new Map(design.nodes.map(node => [node.id, node]));
  const names = new Map(design.nodes.map(node => [node.id, node.properties.Name || designerSymbol(node.id)]));
  const namespaces = new Map();
  for (const node of design.nodes) {
    if (!node.projectType) continue;
    const namespace = node.projectType.slice(0, node.projectType.lastIndexOf('.'));
    if (!namespace) authoringError('SFD1874', 'XAML project controls require a namespace-qualified type.');
    if (!namespaces.has(namespace)) namespaces.set(namespace, 'project' + namespaces.size);
  }
  const typeName = node => node.projectType ? namespaces.get(node.projectType.slice(0, node.projectType.lastIndexOf('.'))) +
    ':' + short(node.projectType) : short(node.type);
  const emit = (node, context, {root = false, states = node.states, resources = '', template = false} = {}) => {
    const name = typeName(node);
    const attributes = [`x:Name="${xml(context.names.get(node.id))}"`];
    const content = [];
    if (root) attributes.push(`xmlns="${presentation}"`, `xmlns:x="${xamlNamespace}"`,
      ...[...namespaces].map(([namespace, prefix]) => `xmlns:${prefix}="using:${xml(namespace)}"`));
    for (const [property, value] of Object.entries(node.properties ?? {})) {
      if (property === 'Name') continue;
      const definition = propertySchema(node.type)[property];
      const owner = definition.attached ? short(definition.owner ?? CONTROLS +
        (['Left', 'Top', 'ZIndex'].includes(property) ? 'Canvas' : property.startsWith('Wrap') ? 'VariableSizedWrapGrid' : 'Grid')) : null;
      const member = owner ? owner + '.' + (definition.member ?? property.replace(/^Wrap/, '')) : property;
      const text = value?.GradientStops || value?.Color && value.Opacity !== undefined ? null : valueText(value, definition.type);
      if (text !== null) attributes.push(`${member}="${xml(text)}"`);
      else content.push(`<${name}.${member}>${valueElement(value, definition.type)}</${name}.${member}>`);
    }
    if (resources) content.push(`<${name}.Resources>${resources}</${name}.Resources>`);
    if (node.style) attributes.push(`Style="{StaticResource ${xml(node.style)}}"`);
    if (node.template) attributes.push(`Template="{StaticResource ${xml(node.template)}}"`);
    for (const [property, reference] of Object.entries(node.resourceReferences ?? {})) {
      attributes.push(`${property}="{${reference.kind === 'theme' ? 'ThemeResource' : 'StaticResource'} ${xml(reference.key)}}"`);
    }
    for (const [property, binding] of Object.entries(node.bindings ?? {})) {
      if (template) attributes.push(`${property}="{TemplateBinding ${xml(binding)}}"`);
      else content.push(bindingXml(name, property, binding));
    }
    for (const [axis, property, element, member] of [['rows', 'RowDefinitions', 'RowDefinition', 'Height'],
      ['columns', 'ColumnDefinitions', 'ColumnDefinition', 'Width']]) {
      if (node[axis]) content.push(`<${name}.${property}>` + node[axis].map(length =>
        `<${element} ${member}="${valueText(length, XAML + 'GridLength')}"/>`).join('') + `</${name}.${property}>`);
    }
    content.push(stateGroupsXml(states, context.nodes, context.names));
    for (const [property, items] of Object.entries(node.collections ?? {})) {
      content.push(`<${name}.${property}>` + items.map((item, index) => {
        if (item && typeof item === 'object') {
          const id = `${node.id}_${property}_${index}`;
          context.names.set(id, designerSymbol(id));
          return emit({...item, id, children: []}, context);
        }
        return valueElement(item, typeof item === 'boolean' ? 'bool' : typeof item === 'number' ? 'double' : 'string');
      }).join('') + `</${name}.${property}>`);
    }
    for (const child of node.children ?? []) content.push(emit(template ? child : context.nodes.get(child), context, {template}));
    return `<${name} ${attributes.join(' ')}>${content.join('')}</${name}>`;
  };
  const templates = (key, template) => {
    const nodes = new Map();
    const partNames = new Map();
    const visit = part => {
      nodes.set(part.id, part);
      partNames.set(part.id, part.properties?.Name || designerSymbol(part.id));
      (part.children ?? []).forEach(visit);
    };
    visit(template.root);
    return `<ControlTemplate x:Key="${xml(key)}" TargetType="${short(template.targetType)}">` +
      emit(template.root, {nodes, names: partNames}, {template: true, states: template.states}) + '</ControlTemplate>';
  };
  const root = byId.get(design.root);
  if (resourcesOnly) {
    const resources = resourceXml(design, templates) || '<ResourceDictionary></ResourceDictionary>';
    return resources.replace('<ResourceDictionary>',
      `<ResourceDictionary xmlns="${presentation}" xmlns:x="${xamlNamespace}">`);
  }
  const visualRoot = root.type === XAML + 'Window' ? byId.get(root.children[0]) : root;
  if (!visualRoot) return `<Grid xmlns="${presentation}" xmlns:x="${xamlNamespace}"/>`;
  return emit(visualRoot, {nodes: byId, names}, {root: true, resources: resourceXml(design, templates)});
}

export function generateDesignResourceXaml(input) {
  return generateDesignXaml(input, {resourcesOnly: true});
}

/** Generated C# loads declarative WinUI markup and wires only explicitly named managed handlers. */
export function generateWinuiXamlCode(design, {className = 'DesignedView', activate = true, responsive = {initialize: [], methods: []}} = {}) {
  const nodes = new Map(design.nodes.map(node => [node.id, node]));
  const root = nodes.get(design.root);
  const content = root.type === XAML + 'Window' ? nodes.get(root.children[0]) : root;
  const lines = [`// Generated by SharpForge Designer for Microsoft WinUI.`, `public class ${className}`, '{'];
  for (const node of design.nodes) lines.push(`    public static ${node.projectType ?? node.type} ${designerSymbol(node.id)};`);
  lines.push(`    public static ${XAML}Window Create()`, '    {',
    `        ${XAML}FrameworkElement root = (${XAML}FrameworkElement)${XAML}Markup.XamlReader.Load(${quoteDesignerString(generateDesignXaml(design))});`);
  for (const node of design.nodes) {
    const variable = designerSymbol(node.id);
    if (node.type === XAML + 'Window') lines.push(`        ${variable} = new ${XAML}Window();`);
    else if (node.id === content?.id) lines.push(`        ${variable} = (${node.projectType ?? node.type})root;`);
    else lines.push(`        ${variable} = (${node.projectType ?? node.type})root.FindName(${quoteDesignerString(node.properties.Name || variable)});`);
    for (const [event, handler] of Object.entries(node.events)) lines.push(`        ${variable}.${event} += ${handler};`);
  }
  const window = root.type === XAML + 'Window' ? designerSymbol(root.id) : 'window';
  if (root.type !== XAML + 'Window') lines.push(`        ${XAML}Window window = new ${XAML}Window();`);
  lines.push(`        ${window}.Content = root;`, `        ${window}.Title = ${quoteDesignerString(root.properties.Title ?? design.name)};`);
  lines.push(...responsive.initialize.map(line => '        ' + line.trim()));
  if (activate) lines.push(`        ${window}.Activate();`);
  lines.push(`        return ${window};`, '    }', ...responsive.methods, '}');
  return lines.join('\n') + '\n';
}
