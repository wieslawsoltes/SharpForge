/**
 * List patterns over arrays (SF-A02-T30): `[p1, .., pn]`, with an optional slice `..` or `.. pattern`.
 *
 *   length test     exactly the number of element patterns, or at least that many when there is a slice
 *   element i       before the slice `input[i]`, after it `input[length - k]`
 *   slice pattern   `RuntimeHelpers.GetSubArray(input, start..^after)` matched against the pattern
 *
 * Elements are read once per run of the tests, like members (emit-patterns.js). A list pattern does not match null.
 * The binder resolves list patterns for arrays only; over any other type the pattern has errors and is refused before
 * it gets here.
 */
import { ArrayTypeSymbol } from '../../symbols/types.js';

/** Class mixin: list patterns. */
export const ListPatternEmission = Base =>
  class extends Base {
    matchListPattern(pattern, input, fail) {
      const il = this.il,
        type = input.type;
      if (!(type instanceof ArrayTypeSymbol) || type.rank !== 1) {
        return this.unsupported(`a list pattern over '${type?.toDisplayString()}'`, pattern.syntax);
      }
      const elementType = type.elementType,
        sliceIndex = pattern.sliceIndex,
        hasSlice = sliceIndex >= 0,
        count = pattern.patterns.length - (hasSlice ? 1 : 0),
        pushInput = () => il.emit('ldloc', input.slot);
      this.matchNotNull(input, fail);
      const length = this.readOnce(input.slot, 'length', this.core.int, () => {
        pushInput();
        il.emit('ldlen').emit('conv.i4');
      });
      il.emit('ldloc', length).emit('ldc.i4', count).emit(hasSlice ? 'blt' : 'bne.un', fail);
      pattern.patterns.forEach((element, index) => {
        if (element.kind === 'SlicePattern') return this.matchSlice(element, { input, start: index, after: count - index }, fail);
        const fromEnd = hasSlice && index > sliceIndex ? pattern.patterns.length - index : 0,
          read = () => {
            pushInput();
            if (fromEnd) il.emit('ldloc', length).emit('ldc.i4', fromEnd).emit('sub');
            else il.emit('ldc.i4', index);
            this.loadElement(elementType);
          },
          slot = this.readOnce(input.slot, fromEnd ? 'element:^' + fromEnd : 'element:' + index, elementType, read);
        return this.patternMatch(element, { slot, type: elementType }, fail);
      });
      if (pattern.local) {
        pushInput();
        this.initializeLocal(pattern.local);
      }
      return undefined;
    }
    /**
     * `.. pattern`: the elements the slice stands for, matched against its pattern (nothing to do without one).
     * @param {{input, start: number, after: number}} range `start` elements come before the slice, `after` follow it
     */
    matchSlice(slice, range, fail) {
      if (!slice.pattern) return undefined;
      const il = this.il,
        { input, start, after } = range,
        type = input.type,
        index = this.indexType,
        shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: index }, { type: index }] },
        read = () => {
          il.emit('ldloc', input.slot).emit('ldc.i4', start);
          this.newIndex(false);
          il.emit('ldc.i4', after);
          this.newIndex(true);
          il.emit('newobj', this.tokens.external(this.rangeType, '.ctor', shape), { pops: 2, pushes: 1 });
          il.emit('call', this.tokens.subArrayMethod(type.elementType, this.rangeType), { pops: 2, pushes: 1 });
        },
        slot = this.readOnce(input.slot, 'slice:' + start + ':' + after, type, read);
      return this.patternMatch(slice.pattern, { slot, type }, fail);
    }
  };
