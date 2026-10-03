"""Observed production renderers and real device loss; no hardware identity inference."""
from browser_harness import wait_condition


def render(page, requested):
    page.evaluate('() => sharpforge.loadSample("winui-graphics")')
    page.evaluate('() => sharpforge.execute("winuiLayout")')
    page.evaluate('() => sharpforge.run()')
    wait_condition(page, 'sharpforge.getState().debug?.uiActive === true')
    page.evaluate('requested => sharpforge.setUIRenderer(requested)', requested)
    page.evaluate('() => sharpforge.uiSettled()')
    wait_condition(page, 'sharpforge.getUIMetrics().length > 0')
    metrics = page.evaluate('sharpforge.getUIMetrics()')
    assert sum(row['primitives'] for row in metrics) >= 8, str(metrics)
    if requested in ['canvas2d', 'dom']:
        assert all(row['backend'] == requested for row in metrics), str(metrics)
    if requested == 'canvas2d':
        pixels = page.evaluate('''() => [...document.querySelectorAll('.sf-winui canvas')].reduce((total,c) => {
          const data=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;
          if(data)for(let i=3;i<data.length;i+=4)if(data[i])total++;return total;},0)''')
        assert pixels > 1000, str(pixels)
    if requested == 'dom':
        assert page.locator('.sf-winui-dom-drawing > div').count() >= 8
    adapter = page.evaluate('''async() => {
      const a=await navigator.gpu?.requestAdapter();
      if(!a)return null;
      const i=a.info??(a.requestAdapterInfo?await a.requestAdapterInfo():{});
      return {vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description,
        isFallbackAdapter:a.isFallbackAdapter??null};
    }''') if requested == 'webgpu' else None
    result = {'requested': requested, 'metrics': metrics, 'adapter': adapter, 'physicalHardware': 'unqualified'}
    if requested == 'webgpu' and not all(row['backend'] == 'webgpu' for row in metrics):
        result['blocker'] = 'GPU-UNAVAILABLE'
    return result


def device_loss(page):
    return page.evaluate('''async() => {
      const {RenderSurface}=await __sharpforgeTestImport('/packages/winui/src/index.js');
      const host=document.createElement('div');
      host.style.cssText='position:fixed;left:80px;top:100px;width:200px;height:100px;z-index:99999';
      document.body.append(host);
      const metrics=[],surface=new RenderSurface(host,{backend:'webgpu',onMetrics:row=>metrics.push(row)});
      try {
        await surface.ready;
        surface.update([{x:0,y:0,w:100,h:80,color:[1,0,0,1]}],200,100);
        const before={backend:surface.backend,reason:surface.reason,primitives:surface.primitives.length};
        if(surface.backend!=='webgpu')return {blocker:'GPU-UNAVAILABLE',before,metrics};
        await surface.device.queue.onSubmittedWorkDone();
        const beforeImage=surface.canvas.toDataURL();
        const lost=surface.device.lost;
        surface.device.destroy();
        const info=await lost;
        await new Promise(resolve=>setTimeout(resolve,0));
        const after={backend:surface.backend,reason:surface.reason,primitives:surface.primitives.length};
        if(!['canvas2d','dom'].includes(after.backend)||after.primitives!==1)throw Error('Device loss dropped content');
        if(after.backend==='canvas2d') {
          const rgba=surface.context.getImageData(10,10,1,1).data;
          if(rgba[0]!==255||rgba[3]!==255)throw Error('Fallback pixels missing');
        } else if(surface.domLayer.children.length!==1)throw Error('Fallback DOM primitive missing');
        return {before,after,beforeImage,afterImage:surface.canvas?.toDataURL()??surface.domLayer.outerHTML,loss:{reason:info.reason,message:info.message},metrics,
          scope:'Real browser GPUDevice.destroy/lost; physical hardware unqualified'};
      } finally {surface.dispose();host.remove();}
    }''')
