import {contracts, types} from '@sharpforge/framework';
import {Builtins, Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';
import {intrinsicDefinitions} from './intrinsic-profile.js';

function uiOwner(name) {
  return ['Microsoft.UI.', 'Microsoft.Graphics.Canvas.', 'Windows.UI.', 'Windows.Foundation.', 'SharpForge.UI.', 'System.ComponentModel.',
    'System.Collections.ObjectModel.', 'System.Collections.Specialized.', 'System.Windows.Input.'].some(prefix => name.startsWith(prefix));
}

function usesUI(image) {
  if (image.types.some(type => type.uiFrameworkBase || type.delegateContract && uiOwner(type.delegateContract))) return true;
  for (const method of image.methods) {
    for (let index = 0; index < method.code.length; index += 3) {
      if (method.code[index] === Op.BUILTIN && uiOwner(Builtins[method.code[index + 1]]?.contract?.owner ?? '')) return true;
    }
  }
  return false;
}

/** Runtime XAML resolves these real CLI tokens; an absent external token never becomes an invented reflection handle. */
export function emitUIMetadataAnchors(context, {maxMembers = 30000, maxTypes = 10000} = {}) {
  if (!usesUI(context.image)) return;
  let members = 0, owners = 0;
  for (const type of types.values()) {
    if (!uiOwner(type.name)) continue;
    if (++owners > maxTypes) throw new CilError('UI metadata type-anchor budget exceeded');
    context.resolveType(type.name);
  }
  for (const contract of contracts) {
    if (!uiOwner(contract.owner)) continue;
    if (++members > maxMembers) throw new CilError('UI metadata member-anchor budget exceeded');
    context.external(contract.owner, contract.name, contract.kind === 'constructor' ? 'void' : contract.result,
      contract.parameters, contract.isStatic);
  }
  const expressionOwners = new Set(['System.String', 'System.Math', 'System.Convert', 'System.Type', 'System.Object']);
  for (const definition of intrinsicDefinitions) {
    if (definition.contract || !expressionOwners.has(definition.descriptor.owner)) continue;
    if (++members > maxMembers) throw new CilError('UI metadata member-anchor budget exceeded');
    const {owner, name, signature} = definition.descriptor;
    context.external(owner, name, signature.returnType, signature.parameters, signature.isStatic);
  }
}
