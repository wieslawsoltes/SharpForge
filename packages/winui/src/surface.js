const shader = `
struct View { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> view: View;
struct In { @location(0) rect:vec4f, @location(1) color:vec4f, @location(2) shape:vec4f };
struct Out { @builtin(position) position:vec4f, @location(0) uv:vec2f, @location(1) color:vec4f, @location(2) @interpolate(flat) shape:vec4f };
@vertex fn vs(input:In,@builtin(vertex_index) vi:u32)->Out {
  let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let uv=corners[vi]; let local=(uv-vec2f(.5))*input.rect.zw;
  let c=cos(input.shape.y); let s=sin(input.shape.y);
  let position=input.rect.xy+input.rect.zw*.5+vec2f(c*local.x-s*local.y,s*local.x+c*local.y);
  var output:Out;output.position=vec4f(position/view.size*vec2f(2,-2)+vec2f(-1,1),0,1);
  output.uv=uv;output.color=input.color;output.shape=input.shape;return output;
}
@fragment fn fs(input:Out)->@location(0) vec4f {
  var coverage=1.0;
  if(input.shape.x>.5){let d=length((input.uv-.5)*2.0);let aa=max(fwidth(d),.0001);coverage=1.0-smoothstep(1.0-aa,1.0+aa,d);}
  let a=input.color.a*coverage;return vec4f(input.color.rgb*a,a);
}`;
export function parseColor(value) {
  if(value?.valueType?.endsWith('.SolidColorBrush')){const c=parseColor(value.Color);c[3]*=Number.isFinite(value.Opacity)?value.Opacity:1;return c;}
  if(value?.valueType==='Windows.UI.Color')return [value.R/255,value.G/255,value.B/255,value.A/255];
  if(typeof value==='string'&&/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)){const n=parseInt(value.slice(1),16);return value.length===9?[(n>>>24)/255,(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255]:[(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255,1];}
  return [0,0,0,0];
}
export function cssColor(value){const [r,g,b,a]=parseColor(value);return `rgba(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)},${a})`;}
function rect(x,y,w,h,color,kind=0,angle=0){return {x,y,w,h,color:parseColor(color),kind,angle};}
export function drawingPrimitives(commands) {
  const result=[];
  for(const c of commands??[]){const a=c.args??[];if(c.op==='FillRectangle')result.push(rect(...a));
    else if(c.op==='DrawLine'){const[x1,y1,x2,y2,width,color]=a,dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy);result.push(rect((x1+x2)/2-length/2,(y1+y2)/2-width/2,length,width,color,0,Math.atan2(dy,dx)));}
    else if(c.op==='ellipse')result.push(rect(...a,1));
  }return result;
}
/** One drawing surface with explicit fallbacks. DOM text/input remains accessible HTML. */
export class RenderSurface {
  constructor(container,{backend='auto',gpu=globalThis.navigator?.gpu,onMetrics=()=>{}}={}){
    this.container=container;this.document=container.ownerDocument;this.requested=backend;this.gpu=gpu;this.onMetrics=onMetrics;
    this.backend='initializing';this.reason='';this.disposed=false;this.primitives=[];this.width=1;this.height=1;this.dpr=1;this.bufferCapacity=0;
    this.ready=this.initialize();
  }
  replaceCanvas(){this.canvas?.remove();this.canvas=this.document.createElement('canvas');this.canvas.className='sf-winui-canvas';this.canvas.setAttribute('aria-hidden','true');this.container.prepend(this.canvas);return this.canvas;}
  async initialize(){
    if(this.requested!=='dom'&&this.requested!=='canvas2d'&&this.gpu){
      try{
        const adapter=await this.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter');
        const device=await adapter.requestDevice();this.initializingDevice=device;if(this.disposed){device.destroy();return;}
        const module=device.createShaderModule({label:'SharpForge WinUI primitives',code:shader});
        const compilation=await module.getCompilationInfo();const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>m.message).join('; '));
        const format=this.gpu.getPreferredCanvasFormat(),context=this.replaceCanvas().getContext('webgpu');if(!context)throw new Error('WebGPU canvas context unavailable');
        context.configure({device,format,alphaMode:'premultiplied'});
        const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:48,stepMode:'instance',attributes:[{shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},{shaderLocation:2,offset:32,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
        if(this.disposed){device.destroy();return;}
        this.device=device;this.context=context;this.pipeline=pipeline;this.uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});this.backend='webgpu';
        device.lost.then(info=>{if(!this.disposed&&this.device===device){this.reason='WebGPU device lost: '+info.message;this.fallback();this.draw();}});
        this.draw();return;
      }catch(error){this.initializingDevice?.destroy();this.initializingDevice=null;this.reason=error.message;}
    }else if(this.requested==='webgpu')this.reason='WebGPU is unavailable';
    this.fallback();this.draw();
  }
  fallback(){if(this.disposed)return;this.device?.destroy();this.device=null;this.vertexBuffer?.destroy();this.vertexBuffer=null;this.bufferCapacity=0;
    this.domLayer?.remove();this.domLayer=null;
    if(this.requested!=='dom'){const canvas=this.replaceCanvas();try{const context=canvas.getContext('2d');if(context){this.context=context;this.backend='canvas2d';return;}}catch{}}
    this.canvas?.remove();this.canvas=null;this.context=null;this.domLayer=this.document.createElement('div');this.domLayer.className='sf-winui-dom-drawing';this.domLayer.setAttribute('aria-hidden','true');this.container.prepend(this.domLayer);this.backend='dom';
  }
  update(primitives,width,height,dpr=globalThis.devicePixelRatio??1){
    if(!Array.isArray(primitives)||primitives.length>10000)throw new RangeError('Drawing surface supports up to 10000 primitives');
    this.primitives=primitives.filter(p=>[p.x,p.y,p.w,p.h,p.angle??0,...p.color].every(Number.isFinite)&&p.w>=0&&p.h>=0);
    this.width=Math.max(1,Math.min(Number(width)||1,16384));this.height=Math.max(1,Math.min(Number(height)||1,16384));this.dpr=Math.max(1,Math.min(dpr,4));this.draw();
  }
  draw(){if(this.disposed||this.backend==='initializing')return;const begin=performance.now(),w=this.width,h=this.height;
    if(this.canvas){const scale=Math.min(this.dpr,Math.sqrt(16777216/(w*h)),16384/w,16384/h),bw=Math.max(1,Math.ceil(w*scale)),bh=Math.max(1,Math.ceil(h*scale));this.pixelScale=scale;if(this.canvas.width!==bw)this.canvas.width=bw;if(this.canvas.height!==bh)this.canvas.height=bh;this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';}
    if(this.backend==='webgpu'){
      const count=this.primitives.length,bytes=Math.max(48,count*48);if(this.bufferCapacity<bytes){this.vertexBuffer?.destroy();this.bufferCapacity=2**Math.ceil(Math.log2(bytes));this.vertexBuffer=this.device.createBuffer({size:this.bufferCapacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      const data=new Float32Array(count*12);this.primitives.forEach((p,i)=>data.set([p.x,p.y,p.w,p.h,...p.color,p.kind??0,p.angle??0,0,0],i*12));
      this.device.queue.writeBuffer(this.uniform,0,new Float32Array([w,h,0,0]));if(data.length)this.device.queue.writeBuffer(this.vertexBuffer,0,data);
      const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.setVertexBuffer(0,this.vertexBuffer);if(count)pass.draw(6,count);pass.end();this.device.queue.submit([encoder.finish()]);
    }else if(this.backend==='canvas2d'){
      const c=this.context;c.setTransform(this.pixelScale,0,0,this.pixelScale,0,0);c.clearRect(0,0,w,h);
      for(const p of this.primitives){c.save();const[r,g,b,a]=p.color;c.fillStyle=`rgba(${r*255},${g*255},${b*255},${a})`;c.translate(p.x+p.w/2,p.y+p.h/2);c.rotate(p.angle??0);if(p.kind===1){c.beginPath();c.ellipse(0,0,p.w/2,p.h/2,0,0,Math.PI*2);c.fill();}else c.fillRect(-p.w/2,-p.h/2,p.w,p.h);c.restore();}
    }else{
      const elements=[...this.domLayer.children];this.primitives.forEach((p,i)=>{const e=elements[i]??this.document.createElement('div');if(!elements[i])this.domLayer.append(e);const[r,g,b,a]=p.color;Object.assign(e.style,{position:'absolute',left:p.x+'px',top:p.y+'px',width:p.w+'px',height:p.h+'px',background:`rgba(${r*255},${g*255},${b*255},${a})`,borderRadius:p.kind===1?'50%':'0',transform:`rotate(${p.angle??0}rad)`});});for(let i=this.primitives.length;i<elements.length;i++)elements[i].remove();
    }
    this.onMetrics({backend:this.backend,requested:this.requested,reason:this.reason,primitives:this.primitives.length,submitMs:performance.now()-begin,pixelWidth:this.canvas?.width??w,pixelHeight:this.canvas?.height??h});
  }
  dispose(){this.disposed=true;this.vertexBuffer?.destroy();this.uniform?.destroy();this.device?.destroy();this.initializingDevice?.destroy();this.canvas?.remove();this.domLayer?.remove();}
}
export {shader as primitiveShader};
