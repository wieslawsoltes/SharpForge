/** Deliberately bounded JSON Schema 2020-12 subset used by the contract files. */
export class SchemaError extends Error {constructor(code,message,path='$'){super(`${path}: ${message}`);this.name='SchemaError';this.code=code;this.path=path;}}
const fail=(code,message,path)=>{throw new SchemaError(code,message,path);};
const keywords=new Set(['$schema','$id','$ref','$defs','title','description','type','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minimum','maximum','minLength','maxLength','pattern','enum','const','anyOf','oneOf']);
export function validate(schema,value,{supportedVersion=1,maxDepth=128,maxNodes=2_000_000}={}){
  if(value&&typeof value==='object'&&(Object.hasOwn(value,'schemaVersion')&&value.schemaVersion!==supportedVersion||schema.properties?.formatVersion?.const!==undefined&&Object.hasOwn(value,'formatVersion')&&value.formatVersion!==schema.properties.formatVersion.const))fail('SCHEMA_VERSION','Unsupported schemaVersion','$');
  let nodes=0;
  const charge=(path,depth)=>{if(++nodes>maxNodes||depth>maxDepth)fail('SCHEMA_LIMIT','Validation budget exceeded',path);};
  // JSON objects are unordered; arrays retain their order. Never invoke toJSON.
  const valueKey=(v,path,depth)=>{
    charge(path,depth);
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(Array.isArray(v)){
      const items=[];
      for(let i=0;i<v.length;i++){
        if(!Object.hasOwn(v,i))fail('SCHEMA_INVALID','Missing array item',`${path}[${i}]`);
        items.push(valueKey(v[i],`${path}[${i}]`,depth+1));
      }
      return '['+items.join(',')+']';
    }
    if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+valueKey(v[k],`${path}.${k}`,depth+1)).join(',')+'}';
    fail('SCHEMA_INVALID','Expected JSON value',path);
  };
  const visit=(s,v,path,depth)=>{
    charge(path,depth);
    if(s===true)return;if(s===false)fail('SCHEMA_INVALID','Value forbidden',path);
    if(!s||typeof s!=='object')fail('SCHEMA_DEFINITION','Invalid schema',path);
    for(const k of Object.keys(s))if(!keywords.has(k))fail('SCHEMA_DEFINITION',`Unsupported keyword ${k}`,path);
    if(s.$ref){if(!s.$ref.startsWith('#/'))fail('SCHEMA_DEFINITION','Only local references supported',path);const ref=s.$ref.slice(2).split('/').reduce((o,k)=>o?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],schema);if(!ref)fail('SCHEMA_DEFINITION','Missing reference',path);visit(ref,v,path,depth+1);}
    for(const key of ['anyOf','oneOf'])if(s[key]){let matches=0;for(const branch of s[key])try{const tag=branch.properties?.kind;if(v&&Object.hasOwn(v,'kind')&&tag&&(typeof tag.const==='string'&&tag.const!==v.kind||Array.isArray(tag.enum)&&tag.enum.every(x=>typeof x==='string')&&!tag.enum.includes(v.kind)))continue;visit(branch,v,path,depth+1);matches++;}catch(e){if(e.code!=='SCHEMA_INVALID')throw e;}if(key==='anyOf'?matches===0:matches!==1)fail('SCHEMA_INVALID',`${key} failed`,path);}
    const type=Array.isArray(v)?'array':v===null?'null':typeof v;
    if(s.type){const matches=t=>t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):t===type; if(!(Array.isArray(s.type)?s.type.some(matches):matches(s.type)))fail('SCHEMA_INVALID',`Expected ${s.type}`,path);}
    let actualKey;const instanceKey=()=>actualKey??=valueKey(v,path,depth);
    if(Object.hasOwn(s,'const')&&instanceKey()!==valueKey(s.const,path,depth))fail('SCHEMA_INVALID','Unexpected constant',path);
    if(s.enum&&!s.enum.some(x=>instanceKey()===valueKey(x,path,depth)))fail('SCHEMA_INVALID','Unexpected enum',path);
    if(typeof v==='number'&&(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum))fail('SCHEMA_INVALID','Number outside bounds',path);
    if(typeof v==='string'&&(s.minLength!==undefined&&v.length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength||s.pattern&&!new RegExp(s.pattern,'u').test(v)))fail('SCHEMA_INVALID','Invalid string',path);
    if(Array.isArray(v)){
      if(s.minItems!==undefined&&v.length<s.minItems||s.maxItems!==undefined&&v.length>s.maxItems)fail('SCHEMA_INVALID','Invalid array length',path);
      if(s.uniqueItems){
        const seen=new Set();
        for(let i=0;i<v.length;i++){
          if(!Object.hasOwn(v,i))fail('SCHEMA_INVALID','Missing array item',`${path}[${i}]`);
          const key=valueKey(v[i],`${path}[${i}]`,depth+1);
          if(seen.has(key))fail('SCHEMA_INVALID','Duplicate array item',path);
          seen.add(key);
        }
      }
      if(s.items)v.forEach((item,i)=>visit(s.items,item,`${path}[${i}]`,depth+1));
    }
    if(v!==null&&typeof v==='object'&&!Array.isArray(v)){for(const k of s.required??[])if(!Object.hasOwn(v,k))fail('SCHEMA_INVALID',`Missing ${k}`,path);for(const [k,item] of Object.entries(v)){if(Object.hasOwn(s.properties??{},k))visit(s.properties[k],item,`${path}.${k}`,depth+1);else if(s.additionalProperties===false)fail('SCHEMA_INVALID',`Unknown property ${k}`,path);else if(s.additionalProperties&&typeof s.additionalProperties==='object')visit(s.additionalProperties,item,`${path}.${k}`,depth+1);}}
  };visit(schema,value,'$',0);return value;
}
