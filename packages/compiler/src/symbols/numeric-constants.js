import {ConstantValue, Decimal, integralRanges} from '../constants/constant-value.js';
import {FieldSymbol, DeclarationModifiers} from './members.js';
import {Accessibility} from './types.js';

function add(type, name, value) {
  if (type.getMembers(name).length) return;
  type.addMember(new FieldSymbol({
    name,
    type,
    declaredAccessibility: Accessibility.Public,
    modifiers: DeclarationModifiers.Const,
    isImplicitlyDeclared: true,
    // FieldSymbol unwraps the outer record; semantic constantOf returns the typed constant.
    constantValue: {value}
  }));
}

/** Complete predefined scalar constants in the closed registry without inventing executable API overloads. */
export function declareNumericConstants(core) {
  // Referenced core libraries own their metadata surface, including deliberately absent members.
  if (core.bridge.assembly) return;
  for (const [name, [minimum, maximum]] of Object.entries(integralRanges)) {
    add(core[name], 'MinValue', ConstantValue.integral(name, minimum));
    add(core[name], 'MaxValue', ConstantValue.integral(name, maximum));
  }
  for (const name of ['float', 'double']) {
    const maximum = name === 'float' ? 3.4028234663852886e38 : Number.MAX_VALUE;
    const values = {
      MinValue: -maximum,
      MaxValue: maximum,
      Epsilon: name === 'float' ? 2 ** -149 : Number.MIN_VALUE,
      NaN: NaN,
      PositiveInfinity: Infinity,
      NegativeInfinity: -Infinity
    };
    for (const [field, value] of Object.entries(values)) add(core[name], field, ConstantValue[name](value));
  }
  const maximum = (1n << 96n) - 1n;
  for (const [field, value] of Object.entries({MinValue: -maximum, MaxValue: maximum, Zero: 0n, One: 1n, MinusOne: -1n})) {
    add(core.decimal, field, ConstantValue.decimal(new Decimal(value, 0)));
  }
}
