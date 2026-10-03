/** Managed arithmetic faults remain injectable without depending on the runtime. */
export function numericFault(context, type, message) {
  const factory = context?.fault ?? ((name, text) => Object.assign(new Error(text), {name}));
  throw factory(type, message);
}

/** Validate a mathematical integer before narrowing it to a CLI storage width. */
export function checkedInteger(value, bits, unsigned, context) {
  const width = BigInt(bits);
  const minimum = unsigned ? 0n : -(1n << (width - 1n));
  const maximum = (1n << (unsigned ? width : width - 1n)) - 1n;
  if (value < minimum || value > maximum) {
    numericFault(context, 'OverflowException', 'Checked arithmetic overflow');
  }
  return value;
}
