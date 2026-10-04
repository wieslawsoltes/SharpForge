import { Op } from '@sharpforge/bytecode';
import { IrEmitter } from '../ir-emitter.js';

/** External project operations stay separate from definition indices until verified PE graph linking. */
export class ProjectReferenceIrEmitter extends IrEmitter {
  expr(node) {
    switch (node.kind) {
      case 'ProjectCall':
        if (node.receiver) this.expr(node.receiver);
        this.args(node.args);
        this.emit(Op.EXTCALL, node.reference.index, node.args.length + (node.receiver ? 1 : 0));
        return;
      case 'ProjectNewObject':
        this.args(node.args);
        this.emit(Op.EXTNEWOBJ, node.reference.index, node.args.length);
        return;
      case 'ProjectField':
        if (node.receiver) this.expr(node.receiver);
        this.emit(node.reference.descriptor.isStatic ? Op.EXTLDSTATIC : Op.EXTLDFLD, node.reference.index);
        return;
      case 'ProjectProperty':
        if (!node.get) throw new Error('An unreadable property reached project reference emission');
        if (node.receiver) this.expr(node.receiver);
        this.args(node.args);
        this.emit(Op.EXTCALL, node.get().index, node.args.length + (node.receiver ? 1 : 0));
        return;
      default:
        super.expr(node);
    }
  }

  prepare(node) {
    if (!['ProjectField', 'ProjectProperty'].includes(node.kind)) return super.prepare(node);
    let receiver = null;
    if (node.receiver) {
      this.expr(node.receiver);
      receiver = this.temp(node.receiver.legacyType);
      this.emit(Op.STLOC, receiver);
      this.emit(Op.POP);
    }
    const args = [];
    for (const argument of node.args ?? []) {
      this.expr(argument);
      const slot = this.temp(argument.legacyType);
      this.emit(Op.STLOC, slot);
      this.emit(Op.POP);
      args.push(slot);
    }
    return { kind: node.kind, type: node.legacyType, reference: node.reference,
      get: node.get, set: node.set, receiver, args };
  }

  referenceArguments(reference) {
    if (reference.receiver !== null) this.emit(Op.LDLOC, reference.receiver);
    for (const slot of reference.args) this.emit(Op.LDLOC, slot);
  }

  loadRef(reference) {
    if (reference.kind === 'ProjectField') {
      this.referenceArguments(reference);
      this.emit(reference.reference.descriptor.isStatic ? Op.EXTLDSTATIC : Op.EXTLDFLD, reference.reference.index);
    } else if (reference.kind === 'ProjectProperty') {
      if (!reference.get) throw new Error('An unreadable property reached project reference emission');
      this.referenceArguments(reference);
      this.emit(Op.EXTCALL, reference.get().index, reference.args.length + (reference.receiver !== null ? 1 : 0));
    } else super.loadRef(reference);
  }

  storeRef(reference) {
    if (!['ProjectField', 'ProjectProperty'].includes(reference.kind)) return super.storeRef(reference);
    const value = this.temp(reference.type);
    this.emit(Op.STLOC, value);
    this.emit(Op.POP);
    this.referenceArguments(reference);
    this.emit(Op.LDLOC, value);
    if (reference.kind === 'ProjectField') {
      this.emit(reference.reference.descriptor.isStatic ? Op.EXTSTSTATIC : Op.EXTSTFLD, reference.reference.index);
    } else {
      if (!reference.set) throw new Error('A readonly property reached project reference emission');
      this.emit(Op.EXTCALL, reference.set().index, reference.args.length + (reference.receiver !== null ? 2 : 1));
    }
    this.emit(Op.POP);
    this.emit(Op.LDLOC, value);
    this.clear(value);
    if (reference.receiver !== null) this.clear(reference.receiver);
    for (const slot of reference.args) this.clear(slot);
  }
}
