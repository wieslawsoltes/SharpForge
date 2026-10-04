/**
 * Locals and arguments (SF-A02-T30): slots for local variables, `this`, reads and writes through by-reference
 * parameters and locals, the address of a variable, and local declarations.
 */
import { RefKind, TypeKind } from '../../symbols/types.js';
import { VariableLocation, FieldLocation, ElementLocation } from './locations.js';
import { isReference, isStructValue, primitiveOf } from './type-facts.js';

const isByReference = refKind => !!refKind && refKind !== RefKind.None;
/** Bound nodes that denote a variable, whose address can be taken in place. */
const variableKinds = new Set(['Local', 'Parameter', 'FieldAccess', 'ArrayAccess']);

/** Class mixin: variables. */
export const VariableEmission = Base =>
  class extends Base {
    /** The slot of a local symbol, declared on first use. */
    slotOf(local) {
      let slot = this.slots.get(local);
      if (slot === undefined) {
        slot = this.il.declareLocal(local.type, { isByReference: isByReference(local.refKind) || !!local.isRef });
        this.slots.set(local, slot);
        this.debug?.local(local, slot);
      }
      return slot;
    }
    argumentIndexOf(parameter, syntax) {
      const index = this.argumentIndexes.get(parameter) ?? this.argumentIndexes.get(parameter.originalDefinition);
      return index ?? this.unsupported(`parameter '${parameter.name}' in this position`, syntax);
    }
    localLocation(local) {
      const byReference = isByReference(local.refKind) || !!local.isRef;
      return new VariableLocation(this, { type: local.type, isArgument: false, index: this.slotOf(local), isByReference: byReference });
    }
    parameterLocation(parameter, syntax) {
      return this.ownParameterLocation(parameter, syntax);
    }
    /** Where a parameter of this method arrives: its argument slot (in a state machine, the field that holds it). */
    ownParameterLocation(parameter, syntax) {
      return new VariableLocation(this, {
        type: parameter.type,
        isArgument: true,
        index: this.argumentIndexOf(parameter, syntax),
        isByReference: isByReference(parameter.refKind),
      });
    }
    /** The location a bound node denotes; see locations.js for the protocol. */
    location(node) {
      switch (node.kind) {
        case 'Local':
          return this.localLocation(node.local);
        case 'Parameter':
          return this.parameterLocation(node.parameter, node.syntax);
        case 'FieldAccess':
          return this.fieldLocation(node.field, node.receiver, node.type);
        case 'ArrayAccess':
          if (node.indices.length !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
          return new ElementLocation(this, node.array, node.indices[0], node.type);
        case 'PropertyAccess':
        case 'IndexerAccess':
          return this.propertyLocation(node);
        default:
          return this.unsupported(`assignment to ${node.kind}`, node.syntax);
      }
    }
    fieldLocation(field, receiver, type) {
      return this.tokenFieldLocation({ token: this.tokens.field(field), isStatic: !!field.isStatic }, receiver, type);
    }
    /** The location of a field named by its token (a field without a symbol, such as the one behind an event). */
    tokenFieldLocation(field, receiver, type) {
      return new FieldLocation(this, field, receiver, type);
    }
    exprLocal(node) {
      this.localLocation(node.local).load();
    }
    exprParameter(node) {
      this.parameterLocation(node.parameter, node.syntax).load();
    }
    /**
     * Pushes what an instance method receives as its first argument: the object it runs on, or a managed pointer to
     * the value for a method of a struct. A state machine keeps it in a field (emit-state-machine.js).
     */
    pushFrameObject() {
      this.il.emit('ldarg', 0);
    }
    /** `this` as a value: the reference itself in a class, a copy of the value in a struct. */
    exprThis(node) {
      if (this.frame.isStatic) return this.unsupported('this in a static context', node.syntax);
      this.pushFrameObject();
      if (!isReference(this.frame.containingType)) this.loadIndirect(this.frame.containingType);
      return undefined;
    }
    exprBase(node) {
      return this.exprThis(node);
    }
    /**
     * Pushes the receiver of an instance member access: an object reference for a reference type, otherwise a managed
     * pointer to the value (to the variable itself when the receiver is one, so that a mutating member changes it).
     */
    receiver(node) {
      if (isReference(node.type) && !primitiveOf(node.type)) this.expression(node);
      else this.address(node);
    }
    /** Pushes a managed pointer to the value of a node: the variable itself, or a temporary copy of an rvalue. */
    address(node) {
      const substitute = this.substitutions.get(node);
      if (substitute?.address) return substitute.address();
      if (node.kind === 'This' || node.kind === 'Base') {
        if (isReference(this.frame.containingType)) return this.spill(node);
        this.pushFrameObject();
        return undefined;
      }
      if (variableKinds.has(node.kind) && !node.constantValue) {
        this.location(node).address();
        return undefined;
      }
      // `out var x` declares the variable where it is passed; `out _` is a variable nobody reads.
      if (node.kind === 'DeclarationExpression' && node.local) return this.declaredAddress(node.local);
      if (node.kind === 'Discard' || node.kind === 'DeclarationExpression') return this.il.emit('ldloca', this.temp(node.type));
      return this.spill(node);
    }
    /** Evaluates an rvalue into a temporary and pushes the temporary's address. */
    spill(node) {
      this.expression(node);
      const slot = this.temp(node.type);
      this.il.emit('stloc', slot).emit('ldloca', slot);
    }
    /** Replaces the managed pointer on the stack by the value it points at. */
    loadIndirect(type) {
      const primitive = primitiveOf(type);
      if (primitive) this.il.emit('ldind.' + (primitive.load ?? primitive.suffix));
      else if (isReference(type)) this.il.emit('ldind.ref');
      else this.il.emit('ldobj', this.tokens.type(type));
    }
    /** Stores the value on the stack through the managed pointer below it. */
    storeIndirect(type) {
      const primitive = primitiveOf(type);
      if (primitive) this.il.emit('stind.' + primitive.store);
      else if (isReference(type)) this.il.emit('stind.ref');
      else this.il.emit('stobj', this.tokens.type(type));
    }
    stmtLocalDeclaration(node) {
      for (const declarator of node.declarations) {
        const local = declarator.local;
        if (!local) return this.unsupported('this declaration form', node.syntax);
        if (local.isConst) continue;
        if (isByReference(local.refKind) || local.isRef) {
          this.address(declarator.value.operand ?? declarator.value);
          this.il.emit('stloc', this.slotOf(local));
          continue;
        }
        this.declare(local, declarator.value);
      }
      return undefined;
    }
    /** Stores the value on the stack as the first value of a local that an expression declares (a pattern, a foreach). */
    initializeLocal(local) {
      this.il.emit('stloc', this.slotOf(local));
    }
    /** Pushes the address of a local declared where it is passed (`out var x`). */
    declaredAddress(local) {
      this.il.emit('ldloca', this.slotOf(local));
    }
    /** Gives a local its initial value; a declaration without one inside a loop must still reset a struct or reference. */
    declare(local, value) {
      const slot = this.slotOf(local);
      if (value) {
        this.expression(value);
        this.il.emit('stloc', slot);
      } else if (isStructValue(local.type) || local.type.typeKind === TypeKind.TypeParameter) {
        this.il.emit('ldloca', slot).emit('initobj', this.tokens.type(local.type));
      }
    }
  };
