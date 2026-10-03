/**
 * Object and collection initializers (SF-A02-T10.6).
 *
 *   new T { A = x }              member initializer: an assignment to a field or property of the new object
 *   new T { A = { B = x } }      nested object initializer: assignments to members of the value read from `A`
 *   new T { A = { x, y } }       nested collection initializer: `Add` calls on the value read from `A`
 *   new T { [i] = x }            index initializer (C# 6): an indexer or array element of the new object
 *   new T { x, { k, v } }        collection initializer: one `Add` call per element, instance or extension
 *
 * Bound shape: an object creation carries `initializers` (`{target, value}` entries) or `collectionInitializers`
 * (`Call` nodes). The receiver of a target and of an `Add` call stands for the object being initialized: member
 * targets keep the node that produces it (`isInitializerTarget`), index targets and `Add` calls use an
 * `ImplicitReceiver` node. The value of a nested initializer is an `ObjectInitializer` node with the same two lists.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind } from '../../symbols/types.js';
import { extensionScopes, resolveExtensionInvocation, receiverRefKind } from '../../overload/extension-methods.js';
import { implementsInterface } from '../../symbols/substitution.js';
import { isSourceSymbol } from '../../semantic/analysis-helpers.js';
import { lookupMembers } from '../inheritance.js';
import { isAccessible } from '../accessibility.js';
import { checkWritable } from '../ref-kinds.js';
import { requiredMembersLeftUnset } from './required-members.js';

const isNamedAssignment = item => item.kind === 'SimpleAssignmentExpression' && item.left.kind === 'IdentifierName';
const isBraceInitializer = syntax => syntax.kind === 'ObjectInitializerExpression' || syntax.kind === 'CollectionInitializerExpression';

/** Class mixin: object, collection, nested and index initializers. */
export const InitializerBinding = Base =>
  class extends Base {
    /** Binds the expressions of an initializer whose type could not be bound, without reporting anything. */
    initializerSilently(initializer) {
      const saved = this.quiet;
      this.quiet = [];
      try {
        for (const item of initializer.expressions) this.initializerItemSilently(item);
      } finally {
        this.quiet = saved;
      }
    }
    initializerItemSilently(item) {
      if (item.kind === 'SimpleAssignmentExpression') {
        if (item.left.kind === 'ImplicitElementAccess') this.arguments(item.left.argumentList);
        if (isBraceInitializer(item.right)) this.initializerSilently(item.right);
        else this.expression(item.right);
      } else if (item.kind === 'ComplexElementInitializerExpression' || isBraceInitializer(item)) this.initializerSilently(item);
      else this.expression(item);
    }
    /** The creation node with its bound initializer attached. */
    withInitializer(creation, initializer) {
      const bound = initializer ? { ...creation, ...this.initializerLists(creation, creation.type, initializer) } : creation;
      if (creation.kind === 'ObjectCreation') this.checkRequiredMembers(bound);
      return bound;
    }
    /** CS9035 for each required member the creation leaves unset, CS9036 for one given a nested initializer. */
    checkRequiredMembers(creation) {
      const { unset, nested } = requiredMembersLeftUnset(creation.type, creation.constructor, creation.initializers, this.core);
      const at = creation.syntax.type ?? creation.syntax.newKeyword ?? creation.syntax;
      for (const member of unset) this.report(at, DiagnosticId.CS9035, [member.toDisplayString()]);
      for (const { member, entry } of nested) this.report(entry.value.syntax, DiagnosticId.CS9036, [member.toDisplayString()]);
    }
    /**
     * `{initializers}` for an object initializer, `{collectionInitializers}` for a collection initializer. As in Roslyn,
     * one `Name = value` element makes the whole list an object initializer, whatever its first element is.
     */
    initializerLists(receiver, type, initializer) {
      const isObject = initializer.kind === 'ObjectInitializerExpression' || initializer.expressions.some(isNamedAssignment);
      if (isObject) return { initializers: this.memberInitializers(receiver, type, initializer) };
      return { collectionInitializers: this.elementInitializers(type, initializer) };
    }
    implicitReceiver(syntax, type) {
      return this.node('ImplicitReceiver', syntax, type, {});
    }
    // ---- object initializers ----
    memberInitializers(receiver, type, initializer) {
      const entries = [],
        assigned = new Set();
      for (const item of initializer.expressions) {
        if (item.kind !== 'SimpleAssignmentExpression' || !['IdentifierName', 'ImplicitElementAccess'].includes(item.left.kind)) {
          this.invalidMemberDeclarator(type, item);
          continue;
        }
        const isNamed = item.left.kind === 'IdentifierName',
          target = isNamed ? this.memberTarget(receiver, type, item) : this.indexTarget(type, item.left, initializer);
        if (!target) {
          if (isBraceInitializer(item.right)) this.initializerSilently(item.right);
          else this.value(item.right);
          continue;
        }
        const member = target.field ?? (isNamed ? target.property : null);
        if (member && assigned.has(member)) this.report(item.left, DiagnosticId.CS1912, [member.name]);
        if (member) assigned.add(member);
        const entry = isBraceInitializer(item.right) ? this.nestedInitializer(target, item) : this.assignedInitializer(target, item);
        if (entry) entries.push(entry);
      }
      return entries;
    }
    /** An element that is not `Name = value` or `[index] = value` in an object initializer. */
    invalidMemberDeclarator(type, item) {
      this.report(item, DiagnosticId.CS0747);
      if (item.kind === 'IdentifierName') {
        const name = item.identifier.valueText,
          found = lookupMembers(type, name, this.core, { within: this.c.containingType, throughType: type }).members;
        if (!found.length && (isSourceSymbol(type) || this.d.registryIsComplete(type, name))) this.report(item, DiagnosticId.CS0117, [this.display(type), name]);
        return;
      }
      this.initializerItemSilently(item);
    }
    /** The field or property named by `Name = ...`, or null when it was reported (or cannot be decided). */
    memberTarget(receiver, type, item) {
      const name = item.left.identifier.valueText,
        found = lookupMembers(type, name, this.core, { within: this.c.containingType, throughType: type }).members.filter(
          m => m.kind === SymbolKind.Field || m.kind === SymbolKind.Property,
        );
      if (!found.length) {
        if (!isSourceSymbol(type) && !type.isAnonymousType && !this.d.registryIsComplete(type, name)) this.lenient(item);
        else this.report(item.left, DiagnosticId.CS0117, [this.display(type), name]);
        return null;
      }
      const member = found[0],
        isField = member.kind === SymbolKind.Field;
      const target = this.node(isField ? 'FieldAccess' : 'PropertyAccess', item.left, member.type, {
        [isField ? 'field' : 'property']: member,
        receiver,
        isInitializerTarget: true,
      });
      if (!member.isStatic) return target;
      this.report(item.left, DiagnosticId.CS1914, [member.toDisplayString()]);
      this.markWrite(target, null);
      return null;
    }
    /** `[args]`: an element of the array, or the indexer, of the object being initialized. */
    indexTarget(type, left, initializer) {
      const args = this.arguments(left.argumentList),
        target = this.elementAccessOn(this.implicitReceiver(initializer, type), args, left);
      if (target.hasErrors) return null;
      target.isInitializerTarget = true;
      return target;
    }
    /** `target = value`: the target must be assignable; an init accessor is, here. */
    assignedInitializer(target, item) {
      this.inObjectInitializer = true;
      const problem = checkWritable(target, 'assignment', this.variableContext);
      this.inObjectInitializer = false;
      if (problem) this.report(item.left, problem.code, problem.args);
      else if (this.setterIsInaccessible(target)) this.report(item.left, DiagnosticId.CS0272, [target.property.toDisplayString()]);
      const value = this.value(item.right);
      this.markWrite(target, value);
      return { target, value: this.convert(value, target.type, item.right) };
    }
    /** A property whose set accessor is less accessible than the property and not accessible here. */
    setterIsInaccessible(target) {
      const setter = target.property?.setMethod;
      if (!setter || setter.declaredAccessibility === target.property.declaredAccessibility) return false;
      const within = this.c.containingType?.originalDefinition ?? null;
      return !isAccessible(setter.originalDefinition ?? setter, within, { withinModule: this.d.assembly.module });
    }
    /** `target = { ... }`: the target is read, never assigned, and what it yields is initialized in place. */
    nestedInitializer(target, item) {
      const member = target.property ?? target.field,
        type = target.type;
      let problem = null;
      if (target.property && !target.property.getMethod) problem = { code: DiagnosticId.CS0154, args: [member.toDisplayString()] };
      else if (target.property && type?.isValueType === true) problem = { code: DiagnosticId.CS1918, args: [member.toDisplayString(), this.display(type)] };
      if (problem) this.report(item.left, problem.code, problem.args);
      target.readChecked = true;
      this.markRead(target);
      // Initializing the members of a struct-typed field in place writes that field.
      if (target.field && type?.isValueType === true) this.markWrite(target, null);
      if (problem) {
        // The nested list is still bound, quietly: what it assigns counts as assigned.
        const saved = this.quiet;
        this.quiet = [];
        try {
          this.initializerLists({ ...target, type }, type, item.right);
        } finally {
          this.quiet = saved;
        }
        return null;
      }
      const lists = this.initializerLists({ ...target, type }, type, item.right);
      return { target, value: this.node('ObjectInitializer', item.right, type, { initializers: [], collectionInitializers: [], ...lists }) };
    }
    // ---- collection initializers ----
    elementInitializers(type, initializer) {
      if (this.knownNotEnumerable(type)) {
        this.report(initializer, DiagnosticId.CS1922, [this.display(type)]);
        this.initializerSilently(initializer);
        return [];
      }
      const calls = [];
      for (const item of initializer.expressions) {
        const isComplex = item.kind === 'ComplexElementInitializerExpression',
          values = isComplex ? item.expressions.map(e => this.elementValue(e)) : [this.elementValue(item)];
        if (values.some(v => v.hasErrors)) continue;
        const call = this.addCall(type, values, item, initializer);
        if (call && !call.hasErrors) calls.push(call);
      }
      return calls;
    }
    /** True when the type certainly does not implement IEnumerable (the registry does not list every interface). */
    knownNotEnumerable(type) {
      if (implementsInterface(type, this.core.ienumerable, this.core)) return false;
      return isSourceSymbol(type) || (!!type.specialType && type.specialType !== 'System_String' && type.specialType !== 'System_Array');
    }
    elementValue(syntax) {
      const value = this.value(syntax);
      return Object.assign(value.hasErrors ? { ...value } : value, { refKind: null, name: null });
    }
    /** The `Add` call of one element: an accessible instance method, else an extension method in scope. */
    addCall(type, values, item, initializer) {
      const receiver = this.implicitReceiver(initializer, type),
        adds = lookupMembers(type, 'Add', this.core, { within: this.c.containingType }).members.filter(m => m.kind === SymbolKind.Method),
        result = adds.length ? this.d.overloads.resolve(adds, values, { name: 'Add' }) : null;
      if (result?.succeeded) {
        if (result.method.isStatic) {
          this.report(item, DiagnosticId.CS1921, [result.method.toDisplayString()]);
          return null;
        }
        return this.finishCall(result, receiver, values, item, {});
      }
      const extension = this.extensionAdd(receiver, values);
      if (extension?.succeeded) {
        const receiverArgument = Object.assign({ ...receiver }, { refKind: receiverRefKind([extension.method]), name: null });
        return this.finishCall(extension, null, [receiverArgument, ...values], item, { isExtension: true });
      }
      const candidates = adds.length ? adds : [];
      if (!candidates.every(isSourceSymbol) || (!adds.length && !isSourceSymbol(type))) {
        if (!this.d.registryIsComplete(type, 'Add')) {
          this.lenient(item);
          return null;
        }
      }
      if (!result) {
        // Roslyn reports the missing Add on each value of the element.
        for (const value of values) this.report(value.syntax, DiagnosticId.CS1061, [this.display(type), 'Add']);
        return null;
      }
      const error = result.error;
      if (error.code === DiagnosticId.CS1503 && error.argument !== undefined) {
        this.report(item, DiagnosticId.CS1950, [(result.best?.definition ?? adds[0]).toDisplayString()]);
        this.report(values[error.argument].syntax, error.code, error.args);
      } else this.report(item, error.code, error.args);
      return null;
    }
    extensionAdd(receiver, values) {
      const chain = this.typeScope.namespaceChain.map(level => ({
          namespace: level.namespace,
          usings: level.scope.usings ? this.d.typeBinder.usingsOf(level.scope) : null,
        })),
        scopes = extensionScopes(chain, 'Add');
      if (!scopes.length) return null;
      return resolveExtensionInvocation('Add', receiver, values, scopes, this.d.overloads, {});
    }
  };
