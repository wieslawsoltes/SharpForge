import {encode,decode} from './value-codec.js';
const value={abiVersion:1,epoch:1,slots:[{kind:'i64',value:'9007199254740993'},{kind:'f64',value:'-0'},{kind:'ref',value:{h:1,g:1}}],handles:[{h:1,g:1,kind:'string',type:'string',data:'Hello, portable ABI'}]};
console.log(JSON.stringify(decode(encode(value)),null,2));
