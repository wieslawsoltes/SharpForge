/**
 * Lowering of pattern matching (SF-A02-T08.2): `is` patterns, switch expressions and switch statements become
 * sequential tests over inputs that are evaluated once (lowering/decision-dag.js). Patterns whose outcome depends
 * on the run-time type of a value need a type-test instruction and are reported as not executable.
 */
import { BuiltinMap } from '@sharpforge/bytecode';
import { SymbolKind } from '../../symbols/types.js';
import { SharedEvaluations } from '../../lowering/decision-dag.js';
import { n } from './node-factory.js';

/** Class mixin: patterns and switches. */
export const PatternTranslation = Base =>
  class extends Base {
    newDecision() {
      return new SharedEvaluations({
        temp: (type, hint) => this.temp(type, hint),
        assign: n.assign,
        local: n.local,
        literal: n.literal,
        conditional: n.conditional,
        sequence: n.sequence,
      });
    }
    /** The governing value of a decision, held so that every test reads the same value. */
    governing(node, decision) {
      const value = this.once(this.expression(node), 'governing');
      return { input: decision.root(node.type, value.read), locals: value.locals, effects: value.effects };
    }
    exprIsPattern(node) {
      const decision = this.newDecision(),
        governing = this.governing(node.operand, decision),
        test = this.patternTest(node.pattern, governing.input, decision);
      return n.sequence([...governing.locals, ...decision.locals], [...governing.effects, ...decision.resets], test);
    }
    exprIs(node) {
      const outcome = node.outcome ?? node.pattern?.outcome;
      const value = this.expression(node.operand);
      if (outcome === 'always' || outcome === 'identity') {
        if (!this.types.isReference(value.legacyType)) return n.sequence([], [value], n.literal(true, 'bool'));
        return n.notEquals(value, n.nullLiteral(value.legacyType));
      }
      return this.unsupported('type tests that need a runtime type check', node.syntax);
    }
    /** A boolean expression that is true when `input` matches `pattern`; pattern variables are assigned on the way. */
    patternTest(pattern, input, decision) {
      switch (pattern.kind) {
        case 'DiscardPattern':
          return n.literal(true, 'bool');
        case 'ConstantPattern':
          return this.constantTest(pattern, input);
        case 'RelationalPattern':
          return n.binary(pattern.operator, input.read(), this.expression(pattern.value), 'bool');
        case 'NotPattern':
          return n.not(this.patternTest(pattern.pattern, input, decision));
        case 'AndPattern':
          return n.logicalAnd(this.patternTest(pattern.left, input, decision), this.patternTest(pattern.right, input, decision));
        case 'OrPattern':
          return n.logicalOr(this.patternTest(pattern.left, input, decision), this.patternTest(pattern.right, input, decision));
        case 'VarPattern':
          return this.bindPatternLocal(pattern, input, n.literal(true, 'bool'));
        case 'TypePattern':
        case 'DeclarationPattern':
          return this.bindPatternLocal(pattern, input, this.typeTest(pattern, input));
        case 'RecursivePattern':
          return this.recursiveTest(pattern, input, decision);
        default:
          return this.unsupported(`${pattern.kind.replace(/Pattern$/, '').toLowerCase()} patterns`, pattern.syntax);
      }
    }
    constantTest(pattern, input) {
      const value = pattern.value;
      if (!value) return this.unsupported('this constant pattern', pattern.syntax);
      const read = input.read();
      if (value.constantValue?.isNull) {
        if (!this.types.isReference(read.legacyType)) return n.literal(false, 'bool');
        return n.equals(read, n.nullLiteral(read.legacyType));
      }
      return n.equals(read, this.expression(value));
    }
    /** A type test whose answer the static types already give; anything else needs a run-time check. */
    typeTest(pattern, input) {
      const read = input.read();
      if (pattern.outcome === 'always' || pattern.outcome === 'identity' || (input.type && pattern.testedType?.equals?.(input.type))) {
        return this.types.isReference(read.legacyType) ? n.notEquals(read, n.nullLiteral(read.legacyType)) : n.literal(true, 'bool');
      }
      return this.unsupported('type patterns that need a runtime type check', pattern.syntax);
    }
    bindPatternLocal(pattern, input, test) {
      if (!pattern.local) return test;
      this.declarePending(pattern.local);
      const store = n.assign(this.variable(pattern.local, pattern.syntax), input.read());
      return n.logicalAnd(test, n.sequence([], [store], n.literal(true, 'bool')));
    }
    recursiveTest(pattern, input, decision) {
      if (pattern.hasPositional) return this.unsupported('positional patterns', pattern.syntax);
      const read = input.read();
      let test = pattern.testedType ? this.typeTest(pattern, input) : null;
      if (!test) test = this.types.isReference(read.legacyType) ? n.notEquals(read, n.nullLiteral(read.legacyType)) : n.literal(true, 'bool');
      for (const property of pattern.properties ?? []) {
        if (!property.member) return this.unsupported('this property pattern', property.syntax);
        const member = this.memberInput(property.member, input, decision, property.syntax);
        test = n.logicalAnd(test, this.patternTest(property.pattern, member, decision));
      }
      return this.bindPatternLocal(pattern, input, test);
    }
    /** The input for a field or property of another input, shared by every test of the decision. */
    memberInput(member, input, decision, syntax) {
      const imageType = this.imageType(member.type, syntax);
      return decision.member(input, member.name, member.type, imageType, () => {
        const access = { kind: member.kind === SymbolKind.Field ? 'FieldAccess' : 'PropertyAccess', syntax, type: member.type };
        const receiver = member.isStatic ? null : input.read();
        if (member.kind === SymbolKind.Field) {
          const record = this.g.fieldOf(member, syntax);
          return record.isStatic ? n.staticField(record) : n.field(receiver, record);
        }
        const reference = this.propertyReference({ ...access, property: member, receiver: null });
        return { ...reference, receiver };
      });
    }
    // ---- switch expression ----
    exprSwitchExpression(node) {
      const decision = this.newDecision(),
        governing = this.governing(node.governing, decision),
        type = this.imageType(node.type, node.syntax);
      // No arm matched: the runtime has no SwitchExpressionException, the profile throws Exception with this message.
      const message = n.literal('No switch expression arm matched.', 'string');
      const failure = n.frameworkCall({ builtin: BuiltinMap.get('Exception.new') }, null, [message], 'Exception');
      let result = n.sequence([], [n.throwStatement(failure)], this.defaultValue(type));
      for (const arm of [...node.arms].reverse()) {
        let test = this.patternTest(arm.pattern, governing.input, decision);
        if (arm.when) test = n.logicalAnd(test, this.expression(arm.when));
        result = n.conditional(test, this.expression(arm.value), result, type);
      }
      return n.sequence([...governing.locals, ...decision.locals], [...governing.effects, ...decision.resets], result);
    }
    // ---- switch statement ----
    /**
     * `switch (v) { sections }`: the matching section is chosen first (labels in order, with their `when` clauses),
     * then the emitter's switch runs it, so `break` keeps its meaning.
     */
    stmtSwitch(node) {
      const decision = this.newDecision(),
        governing = this.governing(node.governing, decision),
        chosen = this.holder('int', 'section');
      let choice = n.literal(-1, 'int'),
        fallback = -1;
      const tests = [];
      node.sections.forEach((section, index) => {
        for (const label of section.labels) {
          if (label.kind === 'default') {
            fallback = index;
            continue;
          }
          let test = this.patternTest(label, governing.input, decision);
          if (label.when) test = n.logicalAnd(test, this.expression(label.when));
          tests.push({ test, index });
        }
      });
      choice = n.literal(fallback, 'int');
      for (const { test, index } of tests.reverse()) choice = n.conditional(test, n.literal(index, 'int'), choice, 'int');
      const span = this.span(node.syntax);
      const sections = node.sections.map((section, index) => ({
        kind: 'SwitchSection',
        syntax: this.span(section.syntax),
        switchLabels: [{ pattern: { value: index, valueType: 'int' } }],
        statements: node.gotoTargets ? [this.sectionEntry(node.gotoTargets, index), this.statement(section.body)] : [this.statement(section.body)],
      }));
      const select = n.sequence([...governing.locals, ...decision.locals], [...governing.effects, ...decision.resets], choice);
      const switchStatement = {
        kind: 'SwitchStatement',
        syntax: span,
        expression: chosen.read(),
        locals: [],
        sections,
        labels: [],
      };
      return n.block([chosen.init(select, span), switchStatement]);
    }
  };
