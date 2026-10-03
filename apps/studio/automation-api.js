/** Contributions preserve descriptors (including live getters), without a shared global registry. */
export function createAutomationApi(){
  const api={},contributions=new Map();
  function contributeAutomation(namespace,members){
    if(typeof namespace!=='string'||!members||typeof members!=='object'||Array.isArray(members))throw new TypeError('Malformed automation contribution');
    const path=namespace?namespace.split('.'):[];if(path.some(key=>!key||['__proto__','prototype','constructor'].includes(key)))throw new TypeError('Invalid automation namespace');
    let target=api;const created=[],ancestry=[];
    try{
      for(const key of path){if(!Object.hasOwn(target,key)){const child={};Object.defineProperty(target,key,{value:child,enumerable:true,configurable:true});created.push([target,key]);}if(!target[key]||typeof target[key]!=='object')throw new Error('Automation namespace collision '+namespace);ancestry.push([target,key]);target=target[key];}
      const descriptors=Object.getOwnPropertyDescriptors(members);for(const key of Object.keys(descriptors))if(['__proto__','prototype','constructor'].includes(key)||Object.hasOwn(target,key))throw new Error('Duplicate automation member '+[namespace,key].filter(Boolean).join('.'));
      for(const descriptor of Object.values(descriptors))descriptor.configurable=true;
      Object.defineProperties(target,descriptors);const token={target,keys:Object.keys(descriptors),created,ancestry};contributions.set(token,token);
      return ()=>{if(!contributions.delete(token))return;for(const key of token.keys)delete target[key];for(const [parent,key]of [...ancestry].reverse())if(parent[key]&&Object.keys(parent[key]).length===0)delete parent[key];};
    }catch(error){for(const [parent,key]of created.reverse())delete parent[key];throw error;}
  }
  return {api,contributeAutomation,dispose(){for(const key of Object.keys(api))delete api[key];contributions.clear();}};
}
export function automationKeyPaths(api,prefix=''){return Object.keys(api).sort().flatMap(key=>{const path=prefix?prefix+'.'+key:key;return api[key]&&typeof api[key]==='object'?[path,...automationKeyPaths(api[key],path)]:[path];});}
