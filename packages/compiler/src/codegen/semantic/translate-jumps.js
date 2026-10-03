/**
 * Lowering of jumps (SF-A02-T43): labels, `goto label`, `goto case` and `goto default` become the plain jumps of the
 * IR (see jump-emitter.js). The virtual machines run the finally blocks a jump leaves, so a jump out of a try block
 * needs nothing more.
 *
 * A jump target is identified by the bound label symbol, or by the section of the bound switch, never by name: two
 * blocks of one method may each declare a label called the same.
 */
import { n } from './node-factory.js';

const mark = label => ({ kind: 'LabelStatement', syntax: n.hidden, label });

/** Class mixin: labeled statements and goto. */
export const JumpTranslation = Base =>
  class extends Base {
    /** The jump target of a bound label (or of a label name when the binder could not declare it). */
    labelOf(key) {
      this.frame.labels ??= new Map();
      let label = this.frame.labels.get(key);
      if (!label) this.frame.labels.set(key, (label = { name: key.name ?? key }));
      return label;
    }
    /** The jump targets of the sections of one switch, created when the switch or the first jump to it is lowered. */
    sectionLabels(gotoTargets) {
      this.frame.sectionLabels ??= new Map();
      let labels = this.frame.sectionLabels.get(gotoTargets);
      if (!labels) this.frame.sectionLabels.set(gotoTargets, (labels = []));
      return labels;
    }
    /** The statement that marks the start of section `index` of a switch that is the target of a `goto case`. */
    sectionEntry(gotoTargets, index) {
      const labels = this.sectionLabels(gotoTargets);
      return mark((labels[index] ??= { name: `section ${index}` }));
    }
    stmtLabeled(node) {
      return n.block([mark(this.labelOf(node.symbol ?? node.label)), this.statement(node.statement)]);
    }
    stmtGoto(node) {
      const label = node.switchTargets
        ? (this.sectionLabels(node.switchTargets)[node.section] ??= { name: `section ${node.section}` })
        : node.label && this.labelOf(node.label);
      if (!label) return this.unsupported('a goto without a target', node.syntax);
      // The sequence point of the goto itself, then the jump.
      return n.block([n.expressionStatement(n.nullLiteral('object'), this.span(node.syntax)), { kind: 'GotoStatement', syntax: n.hidden, label }]);
    }
  };
