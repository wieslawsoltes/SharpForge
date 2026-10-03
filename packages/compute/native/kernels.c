// Copyright SharpForge contributors. MIT. Rebuild with scripts/build-simd.sh.
#include <wasm_simd128.h>
#define EXPORT(name) __attribute__((export_name(name)))
EXPORT("f64_binary") void f64_binary(const double *a,const double *b,double *out,int n,int op){
 int i=0;for(;i+2<=n;i+=2){v128_t x=wasm_v128_load(a+i),y=wasm_v128_load(b+i),r;
 switch(op){case 0:r=wasm_f64x2_add(x,y);break;case 1:r=wasm_f64x2_sub(x,y);break;case 2:r=wasm_f64x2_mul(x,y);break;case 3:r=wasm_f64x2_div(x,y);break;case 4:r=wasm_f64x2_min(x,y);break;default:r=wasm_f64x2_max(x,y);break;}wasm_v128_store(out+i,r);}
 for(;i<n;i++)switch(op){case 0:out[i]=a[i]+b[i];break;case 1:out[i]=a[i]-b[i];break;case 2:out[i]=a[i]*b[i];break;case 3:out[i]=a[i]/b[i];break;case 4:out[i]=wasm_f64x2_extract_lane(wasm_f64x2_min(wasm_f64x2_splat(a[i]),wasm_f64x2_splat(b[i])),0);break;default:out[i]=wasm_f64x2_extract_lane(wasm_f64x2_max(wasm_f64x2_splat(a[i]),wasm_f64x2_splat(b[i])),0);break;}
}
EXPORT("i32_binary") void i32_binary(const int *a,const int *b,int *out,int n,int op){
 int i=0;for(;i+4<=n;i+=4){v128_t x=wasm_v128_load(a+i),y=wasm_v128_load(b+i),r;
 switch(op){case 0:r=wasm_i32x4_add(x,y);break;case 1:r=wasm_i32x4_sub(x,y);break;case 2:r=wasm_i32x4_mul(x,y);break;case 4:r=wasm_i32x4_min(x,y);break;case 5:r=wasm_i32x4_max(x,y);break;case 6:r=wasm_v128_and(x,y);break;default:r=wasm_v128_xor(x,y);break;}wasm_v128_store(out+i,r);}
 for(;i<n;i++)switch(op){case 0:out[i]=(unsigned)a[i]+(unsigned)b[i];break;case 1:out[i]=(unsigned)a[i]-(unsigned)b[i];break;case 2:out[i]=(unsigned)a[i]*(unsigned)b[i];break;case 4:out[i]=a[i]<b[i]?a[i]:b[i];break;case 5:out[i]=a[i]>b[i]?a[i]:b[i];break;case 6:out[i]=a[i]&b[i];break;default:out[i]=a[i]^b[i];break;}
}
EXPORT("f64_reduce") double f64_reduce(const double*a,const double*b,int n,int dot){v128_t acc=wasm_f64x2_splat(0);int i=0;for(;i+2<=n;i+=2){v128_t x=wasm_v128_load(a+i);if(dot)x=wasm_f64x2_mul(x,wasm_v128_load(b+i));acc=wasm_f64x2_add(acc,x);}double s=wasm_f64x2_extract_lane(acc,0)+wasm_f64x2_extract_lane(acc,1);for(;i<n;i++)s+=dot?a[i]*b[i]:a[i];return s;}
EXPORT("i32_reduce") int i32_reduce(const int*a,const int*b,int n,int dot){v128_t acc=wasm_i32x4_splat(0);int i=0;for(;i+4<=n;i+=4){v128_t x=wasm_v128_load(a+i);if(dot)x=wasm_i32x4_mul(x,wasm_v128_load(b+i));acc=wasm_i32x4_add(acc,x);}unsigned s=(unsigned)wasm_i32x4_extract_lane(acc,0)+(unsigned)wasm_i32x4_extract_lane(acc,1)+(unsigned)wasm_i32x4_extract_lane(acc,2)+(unsigned)wasm_i32x4_extract_lane(acc,3);for(;i<n;i++)s+=dot?(unsigned)a[i]*(unsigned)b[i]:(unsigned)a[i];return (int)s;}
