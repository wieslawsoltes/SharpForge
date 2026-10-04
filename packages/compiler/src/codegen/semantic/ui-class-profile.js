/** The executable UI subclass profile: registered UI ancestry, typed callbacks and checked dispatch. */
import {findContracts} from '@sharpforge/framework';
import {TypeKind} from '../../symbols/types.js';
import {isScalarType} from '../scalar-values.js';
import {n} from './node-factory.js';
import {isRegisteredListInterface} from './ui-list-interfaces.js';
import {isRegisteredUICallbackOwner, isRegisteredUIReference} from './ui-framework-profile.js';

const runtime = 'SharpForge.UI.Runtime';
const interfaces = new Set([
  'Microsoft.UI.Xaml.Data.INotifyPropertyChanged', 'System.ComponentModel.INotifyPropertyChanged',
  'Microsoft.UI.Xaml.Data.IValueConverter', 'System.Windows.Input.ICommand', 'Microsoft.UI.Xaml.Input.ICommand',
  'System.Collections.Specialized.INotifyCollectionChanged'
]);
const sourceDefinition = symbol => symbol?.originalDefinition ?? symbol;
const maxAncestry = 256;

export class UIClassProfile {
  constructor(generator) { this.g = generator; this.cache = new Map(); }

  frameworkName(type) { return type ? this.g.bridge.registryName(type) : null; }

  supportedInterface(type) {
    const name = this.frameworkName(type);
    return interfaces.has(name) || isRegisteredListInterface(this.g.bridge, name);
  }

  /** A source interface implementer is admitted only for the closed UI callback interfaces above. */
  info(type) {
    if (!type) return null;
    if (this.cache.has(type)) return this.cache.get(type);
    const chain = [], seen = new Set();
    let frameworkBase = null, callbackInterface = false;
    for (let current = type; current && current.specialType !== 'System_Object'; current = current.baseType) {
      if (seen.has(current) || chain.length >= maxAncestry) this.g.unsupported('cyclic or excessive UI ancestry', type.locations?.[0]);
      seen.add(current); chain.push(current);
      const name = this.frameworkName(current);
      if (name?.startsWith('Microsoft.UI.Xaml.')) { frameworkBase = name; break; }
      if (this.supportedInterface(current) || current.interfaces?.some(i => this.supportedInterface(i))) callbackInterface = true;
      if (!this.g.isSource(current)) break;
    }
    const result = frameworkBase || callbackInterface ? {frameworkBase, chain} : null;
    this.cache.set(type, result);
    return result;
  }

  accepts(type) { return !!this.info(type); }

  configure(type, owner) {
    const info = this.info(type);
    if (!info) return;
    const base = type.baseType;
    owner.base = base?.specialType !== 'System_Object'
      ? this.frameworkName(base) ?? this.g.classOf(base).name : 'object';
    if (info.frameworkBase) owner.uiFrameworkBase = info.frameworkBase;
    owner.interfaces = [...new Set(type.interfaces.map(i => this.frameworkName(i) ?? i.toDisplayString()))];
    if (base && this.g.isSource(base)) {
      const inherited = this.g.classOf(base);
      owner.fieldOffset = (inherited.fieldOffset ?? 0) + inherited.fields.length;
    }
  }

  supportsMethod(symbol) {
    const owner = symbol?.containingType ?? symbol?.containingSymbol;
    return !symbol?.isStatic && this.accepts(owner) && !symbol?.isAbstract;
  }

  virtualSlot(symbol) {
    return symbol.name + '(' + symbol.parameters.map(p => this.g.types.imageType(p.type, p.syntax)).join(',') + ')';
  }

  methodMetadata(symbol) {
    if (!this.supportsMethod(symbol)) return {};
    const owner = symbol.containingType ?? symbol.containingSymbol;
    const implementsInterface = owner.allInterfaces?.some(type => this.supportedInterface(type) &&
      type.getMembers(symbol.name).some(member => member.parameters?.length === symbol.parameters.length &&
        member.parameters.every((parameter, index) => parameter.type.equals(symbol.parameters[index].type))));
    const virtual = symbol.isVirtual || symbol.isOverride || implementsInterface;
    if (!virtual) return {};
    if (symbol.parameters.some(p => p.refKind && p.refKind !== 'none')) {
      this.g.unsupported('UI virtual methods with by-reference parameters', symbol.locations?.[0]);
    }
    return {isVirtual: true, isOverride: !!symbol.isOverride,
      isFinal: !!implementsInterface && !symbol.isVirtual && !symbol.isOverride, virtualSlot: this.virtualSlot(symbol)};
  }

  dispatches(symbol, receiver) {
    if (!symbol || symbol.isStatic || receiver?.kind === 'Base') return false;
    const owner = symbol.containingType ?? symbol.containingSymbol;
    if (this.supportedInterface(owner)) return true;
    return this.accepts(owner) && !!(symbol.isVirtual || symbol.isOverride);
  }

  allowsDelegate(method) {
    const owner = this.frameworkName(method.containingType ?? method.containingSymbol) ?? method.contract?.owner;
    return isRegisteredUICallbackOwner(this.g.bridge, owner);
  }

  intrinsic(name, args, result) {
    const contract = findContracts(runtime, name, true).find(c => c.parameters.length === args.length);
    if (!contract) return this.g.unsupported(`missing UI runtime contract '${runtime}.${name}'`);
    return n.frameworkCall({contract}, null, args, result ?? contract.result);
  }

  objectArguments(args) {
    return n.newArray('object', n.literal(args.length, 'int'), args);
  }

  invoke(symbol, receiver, args) {
    return this.intrinsic('InvokeVirtual', [receiver, n.literal(this.virtualSlot(symbol), 'string'), this.objectArguments(args)]);
  }

  canTest(type) {
    return this.accepts(type) || this.supportedInterface(type) || isRegisteredUIReference(this.g.bridge, this.frameworkName(type));
  }

  canUnbox(node, owner) {
    const name = this.frameworkName(node.type) ?? (node.type?.specialType ? this.g.types.imageType(node.type, node.syntax) : null);
    const scalar = name === 'bool' || isScalarType(name);
    const value = ['value', 'enum'].includes(this.g.bridge.types.get(name)?.kind);
    const contract = node.operand?.method?.contract;
    const uiValue = contract?.owner.startsWith('Microsoft.UI.') && contract.result === 'object';
    const uiBody = owner?.uiFrameworkBase || owner?.interfaces.some(type => interfaces.has(type));
    return (scalar || value) && !!(uiValue || uiBody || name === 'float' || name === 'uint');
  }

  test(value, type) {
    return this.intrinsic('IsInstance', [value, n.literal(this.g.types.imageType(type), 'string')], 'bool');
  }

  cast(value, type) {
    return this.intrinsic('Cast', [value, n.literal(this.g.types.imageType(type), 'string')]);
  }

  /** An explicit base call remains statically bound and initializes the same source object. */
  baseConstructor(type, receiver, translator, call = null) {
    const info = this.info(type), base = type.baseType;
    if (!info || !base || base.specialType === 'System_Object') return null;
    const args = call ? translator.arguments(call, call.method) : [];
    if (this.g.isSource(base)) {
      const symbol = call?.method ?? base.getMembers('.ctor').find(m => !m.parameters.length);
      const target = symbol && !symbol.isImplicitlyDeclared
        ? this.g.methodOf(symbol) : this.g.implicitConstructors.get(base);
      if (!target) return this.g.unsupported('a UI base class without an executable parameterless constructor', type.locations?.[0]);
      return n.call(target, receiver, args);
    }
    const name = this.frameworkName(base);
    const contracts = this.g.bridge.byOwner.get(name) ?? [];
    const ctor = call?.method?.contract ?? contracts.find(c => c.kind === 'constructor' && !c.parameters.length);
    if (!ctor) return this.g.unsupported(`the UI base constructor of '${name}' is not registered`, type.locations?.[0]);
    return this.intrinsic('InitializeFrameworkBase', [receiver, n.literal(name, 'string'), this.objectArguments(args)], 'void');
  }
}

/** Reserved type naming makes compiler delegate/cell metadata identifiable even without private debug streams. */
export const loweredDelegateName = typeName => 'SharpForge.<>Delegate{' + encodeURIComponent(typeName) + '}';

export function isUIFrameworkInterface(type, bridge) {
  return type?.typeKind === TypeKind.Interface && interfaces.has(bridge.registryName(sourceDefinition(type)) ?? bridge.registryName(type));
}
