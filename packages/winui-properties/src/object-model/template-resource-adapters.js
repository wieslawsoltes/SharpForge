import {ControlTemplate, DataTemplate, ItemsPanelTemplate} from '../templates/template-factory.js';
import {getResourceServices} from './resource-services.js';
import {ResourceFault} from '../resources/errors.js';
import {resourceTargetType} from './resource-target-type.js';
import {withUIConstruction} from './construction-roots.js';

const x = 'Microsoft.UI.Xaml.';
const controls = x + 'Controls.';

/** Managed delegate factories and XAML factories share the same per-instance template lifetime. */
export function registerTemplateResourceAdapters(registry) {
  for (const [owner, Template] of [[controls + 'ControlTemplate', ControlTemplate], [x + 'DataTemplate', DataTemplate],
    [controls + 'ItemsPanelTemplate', ItemsPanelTemplate]]) {
    registry.register({owner, kind: 'constructor', name: '.ctor'}, ({context, args}) => {
      if (!args.length) return Template === ControlTemplate ? context.allocate(owner) : context.wrapModel(new Template(), owner);
      const factory = args[0];
      const model = new Template(templateContext => context.invokeManaged(factory, [templateContext.owner]));
      model.retainedValues = function* () { yield factory; };
      return context.wrapModel(model, owner);
    });
    registry.register({owner, name: 'LoadContent'}, ({context, receiver}) => withUIConstruction(context, () => {
      const model = context.unwrapModel(receiver);
      const template = model instanceof Template ? model : getResourceServices(context).templateModel(receiver);
      const instance = template.instantiate({adapter: context.templateHostAdapter});
      if (instance.root) context.state(instance.root, 'templateInstance', () => instance);
      else instance.dispose();
      return instance.root;
    }, [receiver]));
  }
  registry.register({owner: controls + 'ControlTemplate', kind: 'get', name: 'get_TargetType'}, ({context, receiver}) => {
    const value = context.unwrapModel(receiver);
    const target = value instanceof ControlTemplate ? value.targetType : resourceTargetType(context, receiver);
    return target ? context.typeValue(target) : null;
  });
  registry.register({owner: controls + 'ControlTemplate', kind: 'set', name: 'set_TargetType'}, ({context, receiver, args}) => {
    const value = context.unwrapModel(receiver);
    if (value instanceof ControlTemplate) value.targetType = args[0] ? context.typeName(args[0]) : null;
    context.write(receiver, 'TargetType', args[0]);
    return null;
  });
  registry.register({owner: controls + 'ControlTemplate', name: 'Bind'}, ({context, args}) => {
    const part = args[0];
    const target = context.native(args[1]);
    const source = context.properties.resolve(args[2]);
    if (!context.propertyRegistry.lookup(context.typeOf(part), target)) throw new ResourceFault('SFTPL018', 'Unknown template target property.');
    const previous = context.native(context.read(part, '$bindings'));
    const bindings = previous ? JSON.parse(previous) : {};
    bindings[target] = source.name;
    context.write(part, '$bindings', JSON.stringify(bindings));
    return null;
  });
  registry.register({owner: controls + 'Control', name: 'ApplyTemplate'}, ({context, receiver}) =>
    getResourceServices(context).applyTemplate(receiver));
  registry.register({owner: controls + 'Control', name: 'OnApplyTemplate'}, () => null);
  registry.register({owner: controls + 'Control', name: 'GetTemplateChild'}, ({context, receiver, args}) =>
    getResourceServices(context).getTemplateChild(receiver, context.native(args[0])));
  registry.register({owner: x + 'FrameworkElement', name: 'FindName'}, ({context, receiver, args}) => {
    const explicit = context.read(receiver, '$nameScope');
    const scope = explicit ? context.unwrapModel(explicit) : null;
    const name = context.native(args[0]);
    return scope?.findName(name) ?? getResourceServices(context).getTemplateChild(receiver, name) ?? context.findName?.(receiver, name) ?? null;
  });
  for (const [owner, name, result] of [[controls + 'DataTemplateSelector', 'SelectTemplate', x + 'DataTemplate'],
    [controls + 'StyleSelector', 'SelectStyle', x + 'Style']]) {
    registry.register({owner, name}, ({context, receiver, args}) => {
      const selector = context.unwrapModel(receiver);
      const method = name[0].toLowerCase() + name.slice(1);
      if (selector !== receiver && typeof selector[method] === 'function') return context.wrapModel(selector[method](...args), result);
      return context.invokeVirtual?.(receiver, name + 'Core', args) ?? null;
    });
  }
}
