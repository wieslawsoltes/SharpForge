const decimalFields=new Set(['Zero','One','MinusOne','MinValue','MaxValue']);

/** Read-only CoreLib constants whose values are represented by exact scalars. */
export function numericFieldDefinition(descriptor) {
  if(descriptor?.kind!=='field'||descriptor.owner!=='System.Decimal'||!decimalFields.has(descriptor.name)||!['decimal','System.Decimal'].includes(descriptor.signature?.type))return null;
  return Object.freeze({owner:descriptor.owner,name:descriptor.name,type:'System.Decimal',readonly:true});
}
