/**
 * Lowering of positional and list patterns (SF-A02-T08.1, T08.2). Like property patterns, they add inputs to the
 * decision (lowering/decision-dag.js): the elements of a tuple, the results of one `Deconstruct` call, the length and
 * the elements of an array. Each input is evaluated at most once however many arms test it.
 */
import { tupleTypeOf } from '../../binder/tuples.js';
import { n } from '../../codegen/semantic/node-factory.js';
import { ArraySlices } from './array-slices.js';

/** Class mixin: positional and list patterns. */
export const StructuralPatternTranslation = Base =>
  class extends Base {
    patternTest(pattern, input, decision) {
      return pattern.kind === 'ListPattern' ? this.listTest(pattern, input, decision) : super.patternTest(pattern, input, decision);
    }
    /** `Type(p1, p2) { Property: p } name`: the type test, the positional parts, the properties, then the variable. */
    recursiveTest(pattern, input, decision) {
      if (!pattern.hasPositional) return super.recursiveTest(pattern, input, decision);
      const positional = pattern.positional;
      if (!positional) return this.unsupported('this positional pattern', pattern.syntax);
      const typed = { ...pattern, hasPositional: false, local: null, properties: [] };
      let test = super.recursiveTest(typed, input, decision);
      const parts = positional.kind === 'tuple' ? this.tupleParts(positional, input, decision) : this.deconstructedParts(positional, input, decision);
      positional.parts.forEach((part, index) => {
        test = n.logicalAnd(test, this.patternTest(part.pattern, parts[index], decision));
      });
      if (pattern.properties?.length) {
        const properties = { ...typed, testedType: null, properties: pattern.properties };
        test = n.logicalAnd(test, super.recursiveTest(properties, input, decision));
      }
      return this.bindPatternLocal(pattern, input, test);
    }
    /** The elements of a tuple input. */
    tupleParts(positional, input, decision) {
      const info = this.g.tuples.classOf(positional.type, null);
      return positional.parts.map((part, index) =>
        decision.member(input, 'Item' + (index + 1), part.type, info.imageTypes[index], () => n.field(input.read(), info.fields[index])),
      );
    }
    /**
     * The results of `input.Deconstruct(out ..)`: the call is one input of the decision - a tuple of its results (the
     * cell itself for a single result) - and the parts are members of it, so the method runs once per decision.
     */
    deconstructedParts(positional, input, decision) {
      const syntax = positional.parts[0]?.syntax,
        method = this.g.methodOf(positional.method, syntax),
        types = positional.parts.map(part => part.type),
        cells = types.map(type => this.g.cellClass(this.imageType(type, syntax)));
      const call = temps => {
        const args = temps.map(temp => n.local(temp)),
          allocate = temps.map((temp, index) => n.assign(n.local(temp), n.allocate(cells[index].record)));
        return [...allocate, positional.isExtension ? n.call(method, null, [input.read(), ...args]) : n.call(method, input.read(), args)];
      };
      const newTemps = () => cells.map(cell => this.temp(cell.record.name, 'out'));
      if (types.length === 1) {
        const holder = decision.member(input, 'Deconstruct()', null, cells[0].record.name, () => {
          const temps = newTemps();
          return n.sequence(temps, call(temps), n.local(temps[0]));
        });
        return [decision.member(holder, 'Value', types[0], cells[0].value.type, () => n.field(holder.read(), cells[0].value))];
      }
      const resultType = tupleTypeOf(this.g.analysis.core.bridge, types, []),
        info = this.g.tuples.classOf(resultType, syntax);
      const results = decision.member(input, `Deconstruct(${types.length})`, resultType, info.record.name, () => {
        const temps = newTemps(),
          values = temps.map((temp, index) => n.field(n.local(temp), cells[index].value));
        return n.sequence(temps, call(temps), this.g.tuples.create(info, values));
      });
      return this.tupleParts({ type: resultType, parts: positional.parts }, results, decision);
    }
    // ---- list patterns ----
    listTest(pattern, input, decision) {
      const arrayType = this.imageType(pattern.inputType, pattern.syntax);
      if (!arrayType.endsWith('[]')) return this.unsupported('list patterns over types other than arrays', pattern.syntax);
      const elementImage = arrayType.slice(0, -2),
        count = pattern.patterns.length,
        slice = pattern.sliceIndex,
        length = decision.member(input, 'Length', null, 'int', () => n.arrayLength(input.read())),
        fixed = slice < 0 ? count : count - 1;
      let test = n.logicalAnd(
        n.notEquals(input.read(), n.nullLiteral(arrayType)),
        n.binary(slice < 0 ? '==' : '>=', length.read(), n.literal(fixed, 'int'), 'bool'),
      );
      pattern.patterns.forEach((element, index) => {
        if (index === slice) {
          if (!element.pattern) return;
          const fromEnd = count - 1 - index,
            part = decision.member(input, `[${index}..^${fromEnd}]`, pattern.inputType, arrayType, () => {
              const end = n.binary('-', length.read(), n.literal(fromEnd, 'int'), 'int');
              return this.arraySlices().slice(elementImage, input.read(), n.literal(index, 'int'), end);
            });
          test = n.logicalAnd(test, this.patternTest(element.pattern, part, decision));
          return;
        }
        if (element.kind === 'DiscardPattern') return;
        const fromEnd = count - index,
          at = slice >= 0 && index > slice ? `[^${fromEnd}]` : `[${index}]`,
          position = () => (slice >= 0 && index > slice ? n.binary('-', length.read(), n.literal(fromEnd, 'int'), 'int') : n.literal(index, 'int')),
          part = decision.member(input, at, pattern.elementType, elementImage, () => n.arrayElement(input.read(), position()));
        test = n.logicalAnd(test, this.patternTest(element, part, decision));
      });
      return this.bindPatternLocal(pattern, input, test);
    }
    arraySlices() {
      // One helper class per generated program, created with the first slice.
      return (this.g.arraySlices ??= new ArraySlices(this.g));
    }
  };
