/**
 * `switch` (SF-A02-T30): the statement and the expression, both as sequential tests of the governing value against
 * each label's pattern in source order, which is the order C# gives the labels their meaning in.
 */

/** Class mixin: switch. */
export const SwitchEmission = Base =>
  class extends Base {
    stmtSwitch(node) {
      const il = this.il,
        input = this.spillValue(node.governing),
        end = il.newLabel(),
        sections = node.sections.map(section => ({ section, label: il.newLabel() }));
      let defaultLabel = end;
      this.withSharedReads(() => {
        for (const { section, label } of sections) {
          for (const pattern of section.labels) {
            if (pattern.kind === 'default') defaultLabel = label;
            else this.switchLabel(pattern, input, label);
          }
        }
      });
      il.emit('br', defaultLabel);
      this.switchSections.set(node.gotoTargets ?? node, sections);
      for (const { section, label } of sections) {
        il.mark(label);
        this.withJumpTargets({ breakLabel: end }, () => this.statement(section.body));
        // C# has no fall through; a section that could complete was already reported by the binder.
        if (il.isReachable) il.emit('br', end);
      }
      il.mark(end);
    }
    /** One `case pattern [when condition]:` - jumps to the section when it applies, else continues with the next label. */
    switchLabel(pattern, input, sectionLabel) {
      const il = this.il,
        next = il.newLabel();
      this.patternMatch(pattern, input, next);
      if (pattern.when) this.branchOn(pattern.when, next, false);
      il.emit('br', sectionLabel);
      il.mark(next);
    }
    exprSwitchExpression(node) {
      const il = this.il,
        input = this.spillValue(node.governing),
        end = il.newLabel();
      this.withSharedReads(() => this.switchArms(node, input, end));
    }
    /** The arms of a switch expression in order; every arm leaves its value on the stack and goes to `end`. */
    switchArms(node, input, end) {
      const il = this.il,
        takesEverything = pattern => pattern.kind === 'DiscardPattern' || (pattern.kind === 'VarPattern' && !pattern.positional);
      for (const arm of node.arms) {
        if (arm === node.arms.at(-1) && !arm.when && takesEverything(arm.pattern)) {
          // An arm that takes every value ends the tests: nothing falls out of the switch.
          this.patternMatch(arm.pattern, input, end);
          this.expression(arm.value);
          il.mark(end);
          return;
        }
        const next = il.newLabel();
        this.patternMatch(arm.pattern, input, next);
        if (arm.when) this.branchOn(arm.when, next, false);
        this.expression(arm.value);
        if (il.isReachable) il.emit('br', end);
        il.mark(next);
      }
      // No arm matched: .NET throws SwitchExpressionException, a subclass of InvalidOperationException.
      const exception = this.core.bridge.coreType('System_Runtime_CompilerServices_SwitchExpressionException') ?? this.core.exception,
        shape = { isStatic: false, returnType: this.core.void, parameters: [] };
      il.emit('newobj', this.tokens.external(exception, '.ctor', shape), { pops: 0, pushes: 1 }).emit('throw');
      il.mark(end);
    }
  };
