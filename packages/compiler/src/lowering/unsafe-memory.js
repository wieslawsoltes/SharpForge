import {TypeKind, ArrayTypeSymbol} from '../symbols/types.js';
import {n} from '../codegen/semantic/node-factory.js';
import {managedDereference, managedAddress} from '../codegen/memory-nodes.js';
import {pointerConversion, pointerBinary, memorySize, memoryPin, memoryUnpin, rawStackAllocation} from '../codegen/unsafe-memory-nodes.js';

const isPointer = type => type?.typeKind === TypeKind.Pointer;
const integer = value => n.literal(value, 'int');
const nullPointer = element => pointerConversion(n.nullLiteral('object'), element);
const fixedConversions = new Set(['Identity', 'ImplicitPointerToVoid', 'ExplicitPointerToPointer']);

export const UnsafeMemoryTranslation = Base => class extends Base {
  constant(node) {
    return isPointer(node.type) && node.constantValue?.isNull
      ? nullPointer(this.imageType(node.type.pointedAtType, node.syntax)) : super.constant(node);
  }
  defaultValue(type) { return type.endsWith('*') ? nullPointer(type.slice(0, -1)) : super.defaultValue(type); }
  exprSizeOf(node) { return memorySize(this.imageType(node.operandType, node.syntax)); }
  exprAddressOf(node) { return pointerConversion(this.addressOf(node.operand), this.imageType(node.type.pointedAtType, node.syntax)); }
  exprPointerIndirection(node) { return managedDereference(this.expression(node.operand), this.imageType(node.type, node.syntax)); }
  exprPointerElementAccess(node) {
    const type = this.imageType(node.type, node.syntax);
    return managedDereference(pointerBinary('+', this.expression(node.pointer), this.pointerOffset(node.index, node.type), type + '*'), type);
  }
  pointerOffset(node, element) {
    return n.binary('*', n.convert(this.expression(node), 'nint'), memorySize(this.imageType(element, node.syntax)), 'nint');
  }
  exprStackAlloc(node) {
    if (!isPointer(node.type)) return super.exprStackAlloc(node);
    const element = this.imageType(node.elementType, node.syntax), initializer = node.elements?.map(value => this.expression(value));
    return rawStackAllocation(element, node.sizes?.length ? this.expression(node.sizes[0]) : integer(initializer?.length ?? 0), initializer);
  }
  exprConversion(node) {
    if (isPointer(node.type)) return pointerConversion(this.expression(node.operand), this.imageType(node.type.pointedAtType, node.syntax));
    if (isPointer(node.operand?.type)) return this.unsupported('exposing a managed memory capability as an integer', node.syntax);
    return super.exprConversion(node);
  }
  exprBinary(node) {
    if (node.family !== 'pointer') return super.exprBinary(node);
    const leftPointer = isPointer(node.left.type), rightPointer = isPointer(node.right.type);
    let left = this.expression(node.left), right = this.expression(node.right);
    const type = this.imageType(node.type, node.syntax);
    if (['+', '-'].includes(node.operator)) {
      if (leftPointer && rightPointer) {
        const bytes = pointerBinary('-', left, right, 'nint');
        return n.binary('/', n.convert(bytes, 'long'), memorySize(this.imageType(node.left.type.pointedAtType, node.syntax)), 'long');
      }
      if (leftPointer) right = this.pointerOffset(node.right, node.left.type.pointedAtType);
      else left = this.pointerOffset(node.left, node.right.type.pointedAtType);
    }
    return pointerBinary(node.operator, left, right, type);
  }
  exprIncrement(node) {
    if (!isPointer(node.operand.type)) return super.exprIncrement(node);
    return {kind: 'PointerIncrement', legacyType: this.imageType(node.type, node.syntax), isExpression: true,
      operand: this.target(node.operand), operator: node.operator, isPostfix: !!node.isPostfix,
      offset: memorySize(this.imageType(node.operand.type.pointedAtType, node.syntax))};
  }
  exprCompoundAssignment(node) {
    if (!isPointer(node.left.type)) return super.exprCompoundAssignment(node);
    return {kind: 'PointerCompound', legacyType: this.imageType(node.type, node.syntax), isExpression: true,
      left: this.target(node.left), operator: node.operator, offset: this.pointerOffset(node.right, node.left.type.pointedAtType)};
  }
  target(node) {
    if (['PointerIndirection', 'PointerElementAccess'].includes(node.kind)) return this.expression(node);
    return super.target(node);
  }
  /** Release every pin on normal completion, return, break, or exception. */
  stmtFixed(node) {
    return this.scoped(() => {
      const pins = [], declarations = [], releases = [], syntax = this.span(node.syntax);
      for (const entry of node.declaration) {
        const element = this.imageType(entry.local.type.pointedAtType, node.syntax);
        const pin = this.addBlockLocal(n.newLocal('$pin' + this.temps++, element + '&', n.hidden, {pinned: true}));
        pins.push(n.declare([[pin, n.nullLiteral(element + '&')]]));
        declarations.push(...this.declareVariable(entry.local, this.fixedPointer(entry.value, element, pin), syntax));
        releases.unshift(n.expressionStatement(memoryUnpin(pin)));
      }
      const body = n.block([...declarations, this.embedded(node.body)]);
      return [...pins, n.tryStatement(body, [], n.block(releases), syntax)];
    });
  }
  fixedPointer(node, element, pin) {
    while (node.kind === 'Conversion' && fixedConversions.has(node.conversion?.kind)) node = node.operand;
    if (node.kind === 'AddressOf') {
      if (!['ArrayAccess', 'PointerIndirection', 'PointerElementAccess'].includes(node.operand.kind))
        return this.unsupported('pinning storage other than an unmanaged array or stack allocation', node.syntax);
      return memoryPin(this.addressOf(node.operand), element, pin);
    }
    if (node.kind !== 'FixedInitializer') return this.unsupported('this fixed initializer', node.syntax);
    const value = node.operand;
    if (value.type instanceof ArrayTypeSymbol) {
      const array = this.once(this.expression(value), 'pinned');
      const present = n.logicalAnd(n.notEquals(array.read(), n.nullLiteral(array.read().legacyType)),
        n.binary('>', n.arrayLength(array.read()), integer(0), 'bool'));
      const address = managedAddress(n.arrayElement(array.read(), integer(0)));
      return n.sequence(array.locals, array.effects, n.conditional(present, memoryPin(address, element, pin), nullPointer(element)));
    }
    return this.unsupported('pinning storage other than an unmanaged array or stack allocation', node.syntax);
  }
};
