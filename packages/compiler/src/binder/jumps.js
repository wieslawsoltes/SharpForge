/**
 * Jump binding (SF-A02-T43): label scopes, `goto label`, `goto case` and `goto default`.
 *
 *   - A label is visible in the block that declares it and in the blocks nested in it (CS0159 elsewhere). Declaring it
 *     twice in one block is CS0140; declaring it again in a nested block is CS0158.
 *   - `goto case e;` needs a constant convertible to the governing type of the nearest switch (CS0150, CS0029; an
 *     explicit-only conversion is the warning CS0469) and a `case` label with that value (CS0159). A jump that cannot be
 *     bound leaves the end of its statement reachable, so the section it is in falls through (CS0163).
 *   - No jump leaves a finally block (CS0157).
 *
 * A bound `Goto` carries its target: `{ label }` for a label, `{ switchTargets, section }` for a switch section, where
 * `switchTargets` is the object the bound `Switch` carries as `gotoTargets`.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { LabelSymbol } from '../symbols/members.js';

const jump = (syntax, completes, target = {}) => ({ kind: 'Goto', syntax, completes, ...target });

/** Class mixin: label scopes and goto statements. */
export const JumpBinding = Base =>
  class extends Base {
    /**
     * Declares the labels of a statement list. With `ownScope` the labels get a scope of their own (a block);
     * without it they join the innermost open scope (the sections of a switch share the scope of the switch block).
     */
    enterLabels(statements, ownScope = true) {
      this.labelScopes ??= [];
      if (ownScope || !this.labelScopes.length) this.labelScopes.push(new Map());
      for (const statement of statements)
        for (let labeled = statement; labeled.kind === 'LabeledStatement'; labeled = labeled.statement) this.declareLabel(labeled);
      return ownScope;
    }
    leaveLabels(ownScope = true) {
      if (ownScope) this.labelScopes.pop();
    }
    declareLabel(syntax) {
      const name = syntax.identifier.valueText,
        scope = this.labelScopes.at(-1);
      if (scope.has(name)) {
        this.report(syntax.identifier, DiagnosticId.CS0140, [name]);
        return;
      }
      if (this.labelScopes.some(outer => outer !== scope && outer.has(name))) this.report(syntax.identifier, DiagnosticId.CS0158, [name]);
      const label = new LabelSymbol({ name, syntax });
      label.uses = 0;
      label.finallyDepth = this.finallyDepth;
      scope.set(name, label);
      this.hasLabels = true;
      this.rootBinder.hasLabelsAnywhere = true;
      (this.rootBinder.allLabels ??= []).push({ label, node: syntax.identifier, uri: this.c.uri });
    }
    /** The label symbol a `Labeled` statement declares (null for a duplicate, which declares nothing). */
    declaredLabel(syntax) {
      const label = this.labelScopes?.at(-1)?.get(syntax.identifier.valueText);
      return label?.syntax === syntax ? label : null;
    }
    /**
     * Looks a label up from the innermost scope outwards.
     * @returns {null|{label: LabelSymbol, outside: boolean}} `outside` when the label belongs to an enclosing body
     *   (a lambda or local function cannot jump into the method that contains it)
     */
    findLabel(name) {
      const own = this.labelScopes ?? [];
      for (let i = own.length - 1; i >= 0; i--) if (own[i].has(name)) return { label: own[i].get(name), outside: false };
      let outside = !!(this.c.isLambda || this.c.isLocalFunction);
      for (let binder = this.c.parent; binder; binder = binder.c.parent) {
        const scopes = binder.labelScopes ?? [];
        for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return { label: scopes[i].get(name), outside };
        outside ||= !!(binder.c.isLambda || binder.c.isLocalFunction);
      }
      return null;
    }
    /** Binds `goto label;`, `goto case e;` and `goto default;`. */
    gotoStatement(syntax) {
      this.usesGoto = true;
      this.rootBinder.usesGoto = true;
      if (syntax.kind === 'GotoStatement') return this.gotoLabel(syntax);
      const enclosing = [...(this.loops ?? [])].reverse().find(target => !target.isLoop);
      if (!enclosing) {
        this.report(syntax, DiagnosticId.CS0153);
        return jump(syntax, true);
      }
      enclosing.hasGotoCase = true;
      const section = this.gotoSection(syntax, enclosing);
      if (section === null) return jump(syntax, true);
      if (this.finallyDepth > enclosing.finallyDepth) this.report(syntax.gotoKeyword, DiagnosticId.CS0157);
      return jump(syntax, false, { switchTargets: enclosing.gotoTargets, section });
    }
    gotoLabel(syntax) {
      if (syntax.expression?.kind !== 'IdentifierName') return jump(syntax, false);
      const name = syntax.expression.identifier.valueText,
        found = this.findLabel(name);
      if (!found) {
        this.report(syntax.expression, DiagnosticId.CS0159, [name]);
        return jump(syntax, false);
      }
      if (found.outside) {
        this.report(syntax.gotoKeyword, DiagnosticId.CS0159, [name]);
        return jump(syntax, false);
      }
      found.label.uses++;
      if (this.finallyDepth > found.label.finallyDepth) this.report(syntax.gotoKeyword, DiagnosticId.CS0157);
      return jump(syntax, false, { label: found.label });
    }
    /** The index of the section a `goto case` / `goto default` targets, or null after reporting why there is none. */
    gotoSection(syntax, enclosing) {
      const targets = (enclosing.gotoTargets ??= this.switchTargets(enclosing));
      if (syntax.kind === 'GotoDefaultStatement') {
        if (targets.defaultSection < 0) {
          this.report(syntax, DiagnosticId.CS0159, ['default:']);
          return null;
        }
        return targets.defaultSection;
      }
      const value = this.value(syntax.expression),
        type = enclosing.governing?.type;
      if (value.hasErrors || !type || enclosing.governing.hasErrors) return null;
      if (!value.constantValue) {
        this.report(syntax, DiagnosticId.CS0150);
        return null;
      }
      let conversion = this.conversions.classifyFromExpression(value, type);
      if (!conversion.exists || !conversion.isImplicit) conversion = this.conversions.classifyCastFromExpression(value, type);
      if (!conversion.exists) {
        this.report(syntax, DiagnosticId.CS0029, [this.display(value.type), this.display(type)]);
        return null;
      }
      if (!conversion.isImplicit) this.report(syntax, DiagnosticId.CS0469, [this.display(type)]);
      const constant = this.quietly(() => this.applyConversion(value, type, conversion, syntax.expression, !conversion.isImplicit)).constantValue;
      if (!constant) return null;
      const section = targets.cases.get(constant.toString());
      if (section === undefined) {
        this.report(syntax, DiagnosticId.CS0159, [`case ${constant.isNull ? 'null' : constant.displayValue}:`]);
        return null;
      }
      return section;
    }
    /**
     * The sections a `goto case` can reach: constant value -> section index, and the default section. The labels are
     * bound here without diagnostics (a goto may target a section that is bound later); the switch reports them.
     */
    switchTargets(enclosing) {
      const targets = { cases: new Map(), defaultSection: -1 },
        type = enclosing.governing?.hasErrors ? null : enclosing.governing?.type;
      this.quietly(() =>
        enclosing.syntax.sections.forEach((section, index) => {
          for (const label of section.labels) {
            if (label.kind === 'DefaultSwitchLabel') {
              if (targets.defaultSection < 0) targets.defaultSection = index;
              continue;
            }
            if (label.kind !== 'CaseSwitchLabel' || !type) continue;
            const pattern = this.pattern({ kind: 'ConstantPattern', expression: label.value, span: label.value.span }, type, enclosing.governing),
              key = pattern.kind === 'ConstantPattern' ? pattern.value?.constantValue?.toString() : undefined;
            if (key !== undefined && !targets.cases.has(key)) targets.cases.set(key, index);
          }
        }),
      );
      return targets;
    }
    /** Runs `action` with its diagnostics discarded. */
    quietly(action) {
      const saved = this.quiet;
      this.quiet = [];
      try {
        return action();
      } finally {
        this.quiet = saved;
      }
    }
  };
