/** Assignable dynamic members/indexers, with once-only receiver and index evaluation (SF-A02-T55). */
import { RefKind } from '../../symbols/types.js';
import { emitDynamicArgument, emitDynamicSite } from './dynamic-sites.js';

/** Implements the ordinary emitter location protocol using Get/Set call sites. */
export class DynamicLocation {
  constructor(emitter, node, storeOwner = node) {
    this.emitter = emitter;
    this.node = node;
    this.type = node.type;
    this.getter = emitter.program.dynamicSites.of(node);
    this.setter = emitter.program.dynamicSites.of(storeOwner, 'set');
    this.operands = null;
    this.storeOperands = null;
  }
  capture() {
    if (this.operands) return;
    const emitter = this.emitter;
    this.storeOperands = [];
    this.operands = this.getter.arguments.map((getterArgument, index) => {
      const setterArgument = this.setter.arguments[index];
      const argument = setterArgument.refKind !== RefKind.None ? setterArgument : getterArgument;
      const isByReference = argument.refKind && argument.refKind !== RefKind.None;
      const slot = emitter.temp(argument.type, { isByReference });
      emitDynamicArgument(emitter, argument);
      emitter.il.emit('stloc', slot);
      const load = target => () => {
        emitter.il.emit('ldloc', slot);
        if (isByReference && (!target.refKind || target.refKind === RefKind.None)) emitter.loadIndirect(argument.type);
      };
      this.storeOperands.push(load(setterArgument));
      return load(getterArgument);
    });
  }
  load() {
    emitDynamicSite(this.emitter, this.getter, this.operands);
  }
  beginStore() {
    this.capture();
  }
  endStore(keepResult = false) {
    const emitter = this.emitter;
    const value = emitter.temp(emitter.core.object);
    emitter.il.emit('stloc', value);
    emitDynamicSite(emitter, this.setter, [...this.storeOperands, () => emitter.il.emit('ldloc', value)]);
    if (!keepResult) emitter.il.emit('pop');
    return keepResult ? undefined : false;
  }
  address() {
    return this.emitter.unsupported('taking the address of a dynamically bound member or indexer', this.node.syntax);
  }
}
