/** Tuple names on metadata relation and event targets beyond ordinary field/property/method signatures. */

/** Uses each actual relation token, including repeated outer constraint rows on nested generic types. */
export function writeTupleRelationAttributes(attributes) {
  const writer = attributes.writer;
  for (const type of writer.types) {
    if (type.baseType) attributes.tupleElementNames(writer.typeToken(type), type.baseType);
    for (const event of writer.plans.get(type).events) {
      attributes.tupleElementNames(writer.eventTokens.get(event.symbol), event.symbol.type);
      // A field-like event's accessors have no source MethodSymbol for the ordinary attribute loop to visit.
      for (const accessor of [event.adder, event.remover]) {
        if (accessor && !accessor.symbol) attributes.tupleElementNames(accessor.parameterTokens?.[0], event.symbol.type);
      }
    }
  }
  for (const row of writer.interfaceRows ?? []) attributes.tupleElementNames(row.token, row.interface);
  for (const row of writer.genericConstraintRows ?? []) attributes.tupleElementNames(row.token, row.type);
}
