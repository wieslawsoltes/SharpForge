/** A synchronous, per-workspace service container. Failed batches roll back in reverse order. */
export function createServiceRegistry(){
  const services=new Map();let disposed=false,registering=false;
  const assertOpen=()=>{if(disposed)throw new Error('Service container is disposed');};
  function registerAll(definitions,{signal}={}){
    assertOpen();if(registering)throw new Error('Nested service registration is not supported');signal?.throwIfAborted();
    const names=new Set();for(const d of definitions){if(!d||typeof d.name!=='string'||!d.name||typeof d.factory!=='function'||d.dispose!==undefined&&typeof d.dispose!=='function')throw new TypeError('Malformed service registration');if(services.has(d.name)||names.has(d.name))throw new Error('Duplicate service '+d.name);names.add(d.name);}
    const added=[];registering=true;
    try{for(const d of definitions){signal?.throwIfAborted();const value=d.factory(api);if(value?.then)throw new TypeError('Service factories must be synchronous');services.set(d.name,{value,dispose:d.dispose});added.push(d.name);}signal?.throwIfAborted();return added.map(name=>services.get(name).value);}
    catch(error){const errors=[error];for(const name of added.reverse()){const entry=services.get(name);services.delete(name);try{entry.dispose?.(entry.value);}catch(failure){errors.push(failure);}}if(errors.length>1)throw new AggregateError(errors,'Service registration and rollback failed');throw error;}
    finally{registering=false;}
  }
  const api={register:(name,factory,dispose)=>registerAll([{name,factory,dispose}])[0],registerAll,get(name){assertOpen();if(!services.has(name))throw new Error('Unknown service '+name);return services.get(name).value;},has:name=>services.has(name),dispose(){if(disposed)return;if(registering)throw new Error('Cannot dispose during registration');disposed=true;const errors=[];for(const [name,entry]of [...services].reverse()){services.delete(name);try{entry.dispose?.(entry.value);}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Service disposal failed');}};
  return api;
}
