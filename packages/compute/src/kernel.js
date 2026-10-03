/** This self-contained factory is also installed verbatim inside numerical workers. */
export function createKernel(base64,{backend='auto',maxElements=1_000_000}={}){
  if(!['auto','wasm','scalar'].includes(backend))throw new TypeError('Unknown compute backend');
  if(!Number.isSafeInteger(maxElements)||maxElements<1||maxElements>1_000_000)throw new RangeError('maxElements must be 1–1000000');
  let api=null,reason=null;
  if(backend!=='scalar')try{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));if(!WebAssembly.validate(bytes))throw Error('SIMD is unavailable');api=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;}catch(e){reason=e.message;if(backend==='wasm')throw e;}
  const operations={add:0,subtract:1,multiply:2,divide:3,min:4,max:5,and:6,xor:7};
  const metrics={backend:api?'wasm-simd128':'scalar',fallbackReason:reason,calls:0,elements:0,copiedBytes:0};
  function execute(operation,a,b=null){
    const C=a instanceof Float64Array?Float64Array:a instanceof Int32Array?Int32Array:null,n=a?.length;
    if(!C||n>maxElements)throw new RangeError('A bounded Float64Array or Int32Array is required');
    const reduce=operation==='sum'||operation==='dot',needsB=operation!=='sum';
    if(!reduce&&!Object.hasOwn(operations,operation)||C===Int32Array&&operation==='divide'||C===Float64Array&&['and','xor'].includes(operation))throw new TypeError('Unsupported numerical operation');
    if(needsB&&(!(b instanceof C)||b.length!==n))throw new RangeError('Input types and lengths must match');
    metrics.calls++;metrics.elements+=n;
    if(api){const size=C.BYTES_PER_ELEMENT,pa=(Number(api.__heap_base.value)+31)&~31,pb=pa+n*size,po=pb+n*size,bytes=po+n*size;
      if(bytes>api.memory.buffer.byteLength)api.memory.grow(Math.ceil((bytes-api.memory.buffer.byteLength)/65536));
      new C(api.memory.buffer,pa,n).set(a);if(needsB)new C(api.memory.buffer,pb,n).set(b);metrics.copiedBytes+=n*size*(needsB?2:1);
      const prefix=C===Float64Array?'f64':'i32';if(reduce)return api[prefix+'_reduce'](pa,pb,n,operation==='dot'?1:0);
      api[prefix+'_binary'](pa,pb,po,n,operations[operation]);metrics.copiedBytes+=n*size;const result=new C(n);result.set(new C(api.memory.buffer,po,n));
      // WebAssembly min/max propagate NaN; JS min/max matches this including signed zero.
      if(C===Float64Array&&(operation==='min'||operation==='max')&&n%2)result[n-1]=Math[operation](a[n-1],b[n-1]);return result;
    }
    if(reduce){const lanes=C===Float64Array?2:4,partial=Array(lanes).fill(0),end=n-n%lanes;for(let i=0;i<end;i++){const v=operation==='dot'?(C===Int32Array?Math.imul(a[i],b[i]):a[i]*b[i]):a[i];partial[i%lanes]=C===Int32Array?(partial[i%lanes]+v)|0:partial[i%lanes]+v;}let total=partial.reduce((x,y)=>C===Int32Array?(x+y)|0:x+y,0);for(let i=end;i<n;i++){const v=operation==='dot'?(C===Int32Array?Math.imul(a[i],b[i]):a[i]*b[i]):a[i];total=C===Int32Array?(total+v)|0:total+v;}return total;}
    const out=new C(n);for(let i=0;i<n;i++){const x=a[i],y=b[i];switch(operation){case'add':out[i]=x+y;break;case'subtract':out[i]=x-y;break;case'multiply':out[i]=C===Int32Array?Math.imul(x,y):x*y;break;case'divide':out[i]=x/y;break;case'min':out[i]=Math.min(x,y);break;case'max':out[i]=Math.max(x,y);break;case'and':out[i]=x&y;break;case'xor':out[i]=x^y;break;}}return out;
  }
  return {execute,metrics,get backend(){return metrics.backend;},get isHardwareAccelerated(){return !!api;}};
}
