// Pure tracing adapter: no heap import, so the heap/value implementation has no
// module initialization cycle. Metadata tables and runtime token owners are opaque.
export function forEachValueReference(value,visit) {
  if(value===null||typeof value!=='object')return;
  if(Number.isInteger(value.h)&&Number.isInteger(value.g)){visit(value);return;}
  if(!value.byref&&!value.valueType)return;
  const pending=[value],seen=new Set();
  while(pending.length) {
    const current=pending.pop();
    if(current===null||typeof current!=='object')continue;
    if(Number.isInteger(current.h)&&Number.isInteger(current.g)){visit(current);continue;}
    if(seen.has(current))continue;seen.add(current);
    if(current.byref){if(current.owner)pending.push(current.owner);}
    else if(current.valueType&&Array.isArray(current.fields)) {
      const bitmap=current.valueType.gcBitmap;
      for(let index=current.fields.length-1;index>=0;index--)if(!bitmap||bitmap[index])pending.push(current.fields[index]);
    }
  }
}
