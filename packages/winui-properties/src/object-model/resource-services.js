import {StyleApplication} from '../styles/style-application.js';
import {TemplateHost} from '../templates/template-host.js';
import {ControlTemplate} from '../templates/template-factory.js';
import {styleModel, setterModel, resourceScopeModel, requireMutableStyle} from './resource-adapter-models.js';
import {createLegacyTemplateFactory} from './template-recipe.js';
import {visualStateManagerModel} from './visual-state-resource-adapters.js';

/** The root owns dispatch/heap mutations; this shared service owns style/template algorithms and lifetimes. */
export function getResourceServices(context) {
  return context.state(null, 'resourceServices', () => new ResourceServices(context));
}

class ResourceServices {
  constructor(context) {
    this.context = context;
    this.reconstructible = true;
  }

  styleApplication(owner) {
    const context = this.context;
    return context.state(owner, 'styleApplication', () => new StyleApplication({target: owner,
      store: context.storeFor(owner), registry: context.propertyRegistry,
      resources: resourceScopeModel(context, owner), namescope: this.templateHost(owner).namescope,
      storeFor: target => context.storeFor(target), bind: context.bindSetter ?? null,
      materializeResource: context.materializeResource,
      resolveStyle: value => value === null ? null : styleModel(context, value),
      isBinding: value => context.isBinding?.(value) ?? value?.constructor?.name === 'Binding'}));
  }

  applyStyle(owner) {
    const context = this.context;
    const reference = context.read(owner, 'Style');
    const application = this.styleApplication(owner);
    try {
      if (context.defaultStyleResourceKey) {
        application.setDefaultStyleResource(context.defaultStyleResourceKey(owner), context.defaultStyleFor?.(owner) ?? null);
      } else if (context.defaultStyleFor) application.setDefaultStyle(context.defaultStyleFor(owner));
      if (reference) application.setStyle(styleModel(context, reference));
      else if (context.native(context.read(owner, '$local:Style'))) application.setStyle(null);
      else application.setStyle(undefined);
    } finally { context.syncOwner?.(owner); }
    return true;
  }

  templateHost(owner) {
    const context = this.context;
    return context.state(owner, 'templateHost', () => new TemplateHost({owner,
      adapter: context.templateHostAdapter,
      registry: context.propertyRegistry,
      resources: resourceScopeModel(context, owner),
      onApplyTemplate: (target, instance) => {
        context.flushContentPresenters?.();
        const application = context.state(target, 'styleApplication');
        if (application) application.context.namescope = instance.namescope;
        visualStateManagerModel(context, target);
        context.onApplyTemplate?.(target, instance);
      }}));
  }

  templateModel(reference) {
    const context = this.context;
    const model = context.unwrapModel(reference);
    if (model instanceof ControlTemplate) return model;
    if (!context.read(reference, 'VisualTree')) {
      return context.state(reference, 'emptyTemplate', () => new ControlTemplate());
    }
    return context.state(reference, 'template', () => createLegacyTemplateFactory(context, reference));
  }

  applyTemplate(owner) {
    const reference = this.context.read(owner, 'Template');
    const operation = () => {
      try { return this.templateHost(owner).apply(reference ? this.templateModel(reference) : null); }
      finally { this.context.syncOwner?.(owner); }
    };
    return this.context.sceneTransaction ? this.context.sceneTransaction(operation) : operation();
  }

  /** Property invalidation refreshes a live tree; initial construction belongs to ApplyTemplate or layout. */
  templateChanged(owner) {
    const host = this.context.state(owner, 'templateHost');
    return host?.initialized && !host.disposed ? this.applyTemplate(owner) : false;
  }

  getTemplateChild(owner, name) { return this.templateHost(owner).getTemplateChild(name); }

  refreshStyleModel(reference) {
    const setter = this.context.typeOf(reference) === 'Microsoft.UI.Xaml.Setter';
    const model = setter ? setterModel(this.context, reference) : styleModel(this.context, reference);
    requireMutableStyle(model);
  }
}
