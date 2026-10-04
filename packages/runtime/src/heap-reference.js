/** Generation-checked managed handle shape, shared without depending on the heap or collector. */
export function isReference(value){return value!==null&&typeof value==='object'&&Number.isInteger(value.h)&&Number.isInteger(value.g);}
