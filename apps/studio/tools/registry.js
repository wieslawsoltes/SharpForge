export function createToolRegistry(){
  const tools=new Map(),mounts=new Set();
  return {
    registerTool(id,title,render,dispose){if(typeof id!=='string'||!id||typeof title!=='string'||typeof render!=='function'||dispose!==undefined&&typeof dispose!=='function')throw new TypeError('Malformed tool');if(tools.has(id))throw new Error('Duplicate tool '+id);const tool=Object.freeze({id,title,render,dispose});tools.set(id,tool);return ()=>{for(const mount of [...mounts])if(mount.id===id)mount.dispose();tools.delete(id);};},
    definitions(){return [...tools.values()].map(({id,title})=>({id,title,kind:'tool'}));},
    mount(id,element,context={}){const tool=tools.get(id);if(!tool)throw new Error('Unknown tool '+id);if(!element||typeof element!=='object')throw new TypeError('Tool element required');const state=Object.create(null);let disposed=false;const mount={id,element,state,render(){if(disposed)throw new Error('Tool mount is disposed');return tool.render(element,{...context,state});},dispose(){if(disposed)return;disposed=true;mounts.delete(mount);tool.dispose?.(element,{...context,state});}};try{mount.render();mounts.add(mount);return mount;}catch(error){try{mount.dispose();}catch(disposal){throw new AggregateError([error,disposal],'Tool mount and cleanup failed');}throw error;}},
    dispose(){const errors=[];for(const mount of [...mounts])try{mount.dispose();}catch(error){errors.push(error);}tools.clear();if(errors.length)throw new AggregateError(errors,'Tool disposal failed');}
  };
}
