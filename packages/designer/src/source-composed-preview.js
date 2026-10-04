import {canonicalType} from '@sharpforge/framework';
import {childSlot} from './model.js';
import {sourcePath} from './source-text.js';
import {designInheritancePreviewProfile, designPreviewCapability} from './source-preview.js';
import {constructorInvokesSourceConstruction} from './source-constructor-preview.js';

function unavailable(reason) {
  return {previewAvailable: false, readOnly: true, sourceWrites: false, reason};
}

function sameSources(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const indexed = new Map(left.map(file => [file.uri, file]));
  return indexed.size === left.length && new Set(right.map(file => file.uri)).size === right.length && right.every(file => {
    const old = indexed.get(file.uri);
    return old?.text === file.text && old.version === file.version
      && !!(old.readOnly || old.readonly) === !!(file.readOnly || file.readonly);
  });
}

/** Qualifies a static factory preview only when every custom child has an independent direct-component proof from identical sources. */
export function designComposedPreviewCapability(analysis, components) {
  if (analysis?.compilationSucceeded !== false || !analysis.structuralEditable || !analysis.context
    || !designInheritancePreviewProfile(analysis.compilerDiagnostics)) {
    return unavailable('Composition requires a closed construction with only the known inheritance-profile errors.');
  }
  const method = analysis.method;
  const document = analysis.document;
  const root = document.nodes.find(node => node.id === document.root);
  const returned = method.body.statements.at(-1);
  const binding = analysis.bindings[document.root];
  const rootName = sourcePath(returned?.expression);
  if (document.previewOnly || root?.projectType || method.name !== 'Create' || !method.modifiers?.includes('static')
    || method.parameters.length || returned?.kind !== 'Return' || !binding
    || ![binding.name, 'this.' + binding.name, analysis.owner?.name + '.' + binding.name].includes(rootName)
    || canonicalType(method.returnType) !== root.type) {
    return unavailable('Composition requires a parameterless static Create returning its explicitly owned framework root.');
  }
  const children = document.nodes.filter(node => node.projectType);
  if (!children.length || !Array.isArray(components) || components.length > 256) {
    return unavailable('Composition requires a bounded set of separately qualified project components.');
  }
  const qualified = new Map();
  for (const component of components) {
    const capability = designPreviewCapability(component);
    if (!capability.previewAvailable || !sameSources(analysis.sources, component.sources)
      || !constructorInvokesSourceConstruction(component)) continue;
    qualified.set(capability.descriptor.type, capability.descriptor);
  }
  const dependencies = new Map();
  for (const child of children) {
    const descriptor = qualified.get(child.projectType);
    if (!descriptor || descriptor.baseType !== child.type) {
      return unavailable(`Project component '${child.projectType}' requires a current preview and a parameterless constructor `
        + 'that directly owns its body or only invokes its owned construction method.');
    }
    const slot = childSlot(child.type);
    if (child.children.length || slot && Object.hasOwn(child.properties, slot.property)) {
      return unavailable(`The host overrides '${child.projectType}' content; that composition requires an explicit source ownership rule.`);
    }
    dependencies.set(descriptor.type, descriptor);
  }
  return {previewAvailable: true, kind: 'composition', readOnly: true, sourceWrites: false,
    dependencies: [...dependencies.values()].map(descriptor => structuredClone(descriptor)),
    reason: 'This closed factory composes qualified component previews. Class inheritance remains unavailable to the runtime profile.'};
}
