/**
 * Closures (SF-A02-T30), emission half of closure-plan.js: captured variables read and written through their cells,
 * `this` inside a closure, the creation of a function's target object and calls of local functions.
 */
import { RefKind } from '../../symbols/types.js';
import { CellLocation } from './locations.js';
import { isVoid } from './type-facts.js';

/** Class mixin: closures. */
export const ClosureEmission = Base =>
  class extends Base {
    get closures() {
      return this.program.closures;
    }
    /** The cell class of a captured variable, or null for a variable that lives in its slot. */
    cellOf(variable) {
      return this.closures.cells.get(variable) ?? null;
    }
    /**
     * Makes the cells of this function reachable: those of the variables it captures are fields of its closure
     * object, and its own captured parameters are copied into fresh cells.
     */
    enterBody() {
      const il = this.il,
        closure = this.frame.function?.closure;
      this.cellAccess = new Map();
      for (const [variable, field] of closure?.fields ?? []) {
        this.cellAccess.set(variable, () => {
          this.pushFrameObject();
          il.emit('ldfld', field.token);
        });
      }
      for (const parameter of this.frame.parameters) {
        const cell = this.cellOf(parameter);
        if (!cell) continue;
        if (parameter.refKind && parameter.refKind !== RefKind.None) this.unsupported(`capturing the by-reference parameter '${parameter.name}'`);
        const slot = this.temp(cell.type);
        il.emit('newobj', cell.constructor.token, { pops: 0, pushes: 1 }).emit('stloc', slot);
        il.emit('ldloc', slot);
        this.ownParameterLocation(parameter).load();
        il.emit('stfld', cell.value.token);
        this.cellAccess.set(parameter, () => il.emit('ldloc', slot));
      }
    }
    /** Pushes the cell object of a captured variable. */
    pushCell(variable) {
      const access = this.cellAccess.get(variable);
      if (access) access();
      else this.il.emit('ldloc', this.slotOf(variable));
    }
    cellLocation(variable, cell) {
      return new CellLocation(this, () => this.pushCell(variable), cell.value.token, variable.type);
    }
    /** The slot of a captured local holds its cell. */
    slotOf(local) {
      const cell = this.cellOf(local);
      if (!cell) return super.slotOf(local);
      let slot = this.slots.get(local);
      if (slot === undefined) {
        slot = this.il.declareLocal(cell.type);
        this.slots.set(local, slot);
      }
      return slot;
    }
    localLocation(local) {
      const cell = this.cellOf(local);
      return cell ? this.cellLocation(local, cell) : super.localLocation(local);
    }
    parameterLocation(parameter, syntax) {
      const cell = this.cellOf(parameter);
      return cell ? this.cellLocation(parameter, cell) : super.parameterLocation(parameter, syntax);
    }
    /** Creates the cell of a captured local where it is declared. */
    newCell(local, cell) {
      const slot = this.slotOf(local);
      this.il.emit('newobj', cell.constructor.token, { pops: 0, pushes: 1 }).emit('stloc', slot);
      return slot;
    }
    declare(local, value) {
      const cell = this.cellOf(local);
      if (!cell) return super.declare(local, value);
      const slot = this.newCell(local, cell);
      if (!value) return undefined;
      this.il.emit('ldloc', slot);
      this.expression(value);
      return this.il.emit('stfld', cell.value.token);
    }
    initializeLocal(local) {
      const cell = this.cellOf(local);
      if (!cell) return super.initializeLocal(local);
      const value = this.temp(local.type);
      this.il.emit('stloc', value);
      const slot = this.newCell(local, cell);
      return this.il.emit('ldloc', slot).emit('ldloc', value).emit('stfld', cell.value.token);
    }
    declaredAddress(local) {
      const cell = this.cellOf(local);
      if (!cell) return super.declaredAddress(local);
      const slot = this.newCell(local, cell);
      return this.il.emit('ldloc', slot).emit('ldflda', cell.value.token);
    }
    /** Inside a closure class `this` is the captured receiver. */
    exprThis(node) {
      const thisField = this.frame.function?.closure?.thisField;
      if (!thisField) return super.exprThis(node);
      this.pushFrameObject();
      return this.il.emit('ldfld', thisField.token);
    }
    address(node) {
      if ((node.kind === 'This' || node.kind === 'Base') && this.frame.function?.closure) return this.spill(node);
      return super.address(node);
    }
    /**
     * Pushes the object a function runs on: a new closure object holding the cells it uses, the current `this`, or
     * (for a delegate over a static function) null.
     */
    pushFunctionTarget(plan, forDelegate) {
      const il = this.il,
        closure = plan.closure;
      if (!closure) {
        if (!plan.isStatic) this.exprThis({ syntax: plan.key.syntax });
        else if (forDelegate) il.emit('ldnull');
        return;
      }
      il.emit('newobj', closure.constructor.token, { pops: 0, pushes: 1 });
      for (const [variable, field] of closure.fields) {
        il.emit('dup');
        this.pushCell(variable);
        il.emit('stfld', field.token);
      }
      if (closure.thisField) {
        il.emit('dup');
        this.exprThis({ syntax: plan.key.syntax });
        il.emit('stfld', closure.thisField.token);
      }
    }
    /** A local function is a method of its own (closure-plan.js); its declaration runs nothing. */
    stmtLocalFunction() {}
    /** The plan of a lambda node or of a local function symbol. */
    functionPlan(key, syntax) {
      return this.closures.functions.get(key) ?? this.unsupported('this lambda or local function', syntax);
    }
    localFunctionCall(node) {
      const method = node.method,
        plan = this.functionPlan(method.originalDefinition ?? method, node.syntax);
      this.pushFunctionTarget(plan, false);
      this.arguments(node, method);
      const effect = { pops: plan.parameters.length + (plan.isStatic ? 0 : 1), pushes: isVoid(plan.returnType) ? 0 : 1 };
      return this.il.emit('call', plan.method.token, effect);
    }
  };
