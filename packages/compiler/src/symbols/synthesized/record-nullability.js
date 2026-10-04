/** The fixed nullable contracts of synthesized record-class members, independent of source #nullable context. */
import { NullableAnnotation, TypeKind, TypeWithAnnotations } from '../types.js';

/** Record structs retain oblivious annotations on their synthesized object/string/builder signature slots. */
export function recordContractType(record, type, nullable = false) {
  const annotation = record.typeKind !== TypeKind.Class ? NullableAnnotation.Oblivious
    : nullable ? NullableAnnotation.Annotated : NullableAnnotation.NotAnnotated;
  // A generic record's self arguments remain oblivious; only this signature slot gets the synthesized contract.
  return TypeWithAnnotations.create(type, annotation);
}
