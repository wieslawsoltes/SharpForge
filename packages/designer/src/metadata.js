import {
  CONTROLS, XAML, canonicalType, frameworkAssignable, frameworkManifest, frameworkType, propertiesFor
} from '@sharpforge/framework';
import {designerDefaultEvent} from './metadata-events.js';

const namesByCategory = Object.freeze({
  Identity: ['Name', 'Title', 'Tag'],
  'Size & spacing': ['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'Margin', 'Padding', 'CornerRadius'],
  Placement: ['Left', 'Top', 'ZIndex', 'Row', 'Column', 'RowSpan', 'ColumnSpan', 'WrapRowSpan', 'WrapColumnSpan',
    'HorizontalAlignment', 'VerticalAlignment', 'Orientation', 'Spacing', 'RowSpacing', 'ColumnSpacing'],
  Appearance: ['Background', 'Foreground', 'BorderBrush', 'BorderThickness', 'Opacity', 'Visibility', 'RequestedTheme',
    'Fill', 'Stroke', 'StrokeThickness', 'RadiusX', 'RadiusY', 'Source'],
  'Text & typography': ['Text', 'Content', 'Header', 'FontSize', 'FontFamily', 'FontWeight', 'TextAlignment', 'TextWrapping',
    'PlaceholderText', 'Description', 'AlternativeText'],
  Interaction: ['IsEnabled', 'IsReadOnly', 'IsHitTestVisible', 'IsTabStop', 'TabIndex', 'IsChecked', 'IsOn', 'IsExpanded',
    'Value', 'Minimum', 'Maximum', 'StepFrequency', 'SmallChange', 'SelectedIndex', 'SelectedItem', 'Password', 'Date', 'Time']
});
const categories = new Map(Object.entries(namesByCategory).flatMap(([category, names]) => names.map(name => [name, category])));
const inputControls = new Set(['TextBox', 'NumberBox', 'PasswordBox', 'AutoSuggestBox', 'Slider', 'CalendarDatePicker',
  'TimePicker', 'ToggleSwitch', 'CheckBox', 'RadioButton', 'ComboBox']);
const containers = new Set(['Border', 'ScrollViewer', 'Viewbox', 'ContentControl', 'ContentPresenter', 'Page', 'UserControl']);
const dimensions = Object.freeze({
  Window: [960, 640], Page: [800, 600], UserControl: [320, 240], ContentDialog: [400, 280],
  TextBlock: [220, 32], Image: [180, 120], Slider: [180, 32], Separator: [180, 1], ProgressRing: [32, 32],
  Grid: [300, 200], Canvas: [300, 200], StackPanel: [240, 160], ListView: [240, 180]
});

/** Metadata covers every instantiable framework visual; no regular-expression category inference is used. */
export function createDesignerMetadata(manifest = frameworkManifest) {
  const types = new Map(manifest.types.map(type => [type.name, type]));
  const controls = manifest.types.filter(type => type.kind === 'window' ||
    ['control', 'shape'].includes(type.kind) && frameworkAssignable(XAML + 'UIElement', type.name));
  return Object.freeze(controls.map(type => {
    const name = type.name.split('.').at(-1);
    const schema = propertiesFor(type.name);
    const panel = frameworkAssignable(CONTROLS + 'Panel', type.name);
    const category = type.kind === 'shape' ? 'Drawing' : panel || containers.has(name) ? 'Layout' :
      inputControls.has(name) ? 'Input' : 'Controls';
    const size = dimensions[name] ?? (panel ? [300, 200] : [180, 40]);
    const defaults = {Width: size[0], Height: size[1]};
    if (schema.Text) defaults.Text = name;
    else if (schema.Content) defaults.Content = name;
    if (!schema.Width) delete defaults.Width;
    if (!schema.Height) delete defaults.Height;
    return Object.freeze({type: type.name, name, category, defaultSize: Object.freeze([...size]),
      defaultProperties: Object.freeze(defaults), root: type.kind === 'window' || ['Page', 'UserControl', 'ContentDialog'].includes(name),
      baseType: types.get(type.name)?.base, defaultEvent: designerDefaultEvent(type, types)});
  }));
}

export const designerMetadata = createDesignerMetadata();

/** Registry-owned immutable schemas amortize manifest traversal across source/property-grid lookups. */
export class DesignerMetadataRegistry {
  constructor(manifest = frameworkManifest) {
    this.manifest = manifest;
    this.schemas = new Map();
    this.emptySchema = Object.freeze({});
    this.attachedSetters = manifest.members.filter(member => member.kind === 'attachedSet' && member.parameters.length === 2);
  }

  propertySchema(type) {
    type = canonicalType(type);
    if (!frameworkType(type)) return this.emptySchema;
    if (this.schemas.has(type)) return this.schemas.get(type);
    const result = {};
    for (const [name, property] of Object.entries(propertiesFor(type))) {
      result[name] = Object.freeze({...property, category: propertyCategory(name), constraints: propertyConstraints(name, property)});
    }
    for (const member of this.attachedSetters) {
      if (!frameworkAssignable(member.parameters[0], type)) continue;
      const name = member.owner === CONTROLS + 'VariableSizedWrapGrid' && !member.property.startsWith('Wrap') ?
        'Wrap' + member.property : member.property;
      result[name] = Object.freeze({type: member.parameters[1], attached: true, owner: member.owner,
        member: member.name.slice(3), category: 'Placement', constraints: propertyConstraints(name, {type: member.parameters[1]})});
    }
    const schema = Object.freeze(result);
    this.schemas.set(type, schema);
    return schema;
  }
}

export const designerMetadataRegistry = new DesignerMetadataRegistry();

/** Attached properties derive from indexed public setters; repeated canonical-type lookups are O(1). */
export function designerPropertySchema(type) {
  return designerMetadataRegistry.propertySchema(type);
}

export function designerChildSlot(type) {
  const schema = designerPropertySchema(type);
  for (const property of ['Children', 'TabItems', 'MenuItems', 'Items']) {
    if (frameworkType(schema[property]?.type)?.kind === 'collection') return {property, many: true};
  }
  if (schema.Child) return {property: 'Child', many: false};
  if (schema.Content) return {property: 'Content', many: false};
  return null;
}

export function propertyCategory(name) {
  return categories.get(name) ?? 'Other';
}

export function propertyConstraints(name, schema) {
  const constraint = {minimum: schema.type === 'int' ? -2147483648 : -Number.MAX_VALUE,
    maximum: schema.type === 'int' ? 2147483647 : Number.MAX_VALUE, integer: schema.type === 'int'};
  if (['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'FontSize', 'Spacing', 'RowSpacing',
    'ColumnSpacing', 'Row', 'Column', 'MaxLength', 'StrokeThickness'].includes(name)) constraint.minimum = 0;
  if (['RowSpan', 'ColumnSpan', 'WrapRowSpan', 'WrapColumnSpan'].includes(name)) constraint.minimum = 1;
  if (name === 'Opacity') Object.assign(constraint, {minimum: 0, maximum: 1});
  return Object.freeze(constraint);
}
