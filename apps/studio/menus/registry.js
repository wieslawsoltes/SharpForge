export function createMenuRegistry(){
  const menus=new Map();
  function validate(items){if(!Array.isArray(items))throw new TypeError('Menu items must be an array');for(const item of items){if(item===null)continue;if(Array.isArray(item)){if(typeof item[0]!=='string'||!['string','function'].includes(typeof item[1]))throw new TypeError('Malformed menu item');}else if(!item||typeof item.label!=='string')throw new TypeError('Malformed menu item');}}
  return {
    registerMenu(id,items){if(typeof id!=='string'||!id)throw new TypeError('Invalid menu id');if(typeof items!=='function')validate(items);const entry=typeof items==='function'?items:items.map(item=>Array.isArray(item)?[...item]:item&&{...item});const list=menus.get(id)??[];list.push(entry);menus.set(id,list);return ()=>{const index=list.indexOf(entry);if(index>=0)list.splice(index,1);if(!list.length)menus.delete(id);};},
    items(id,...args){const items=(menus.get(id)??[]).flatMap(entry=>typeof entry==='function'?entry(...args):entry);validate(items);return items.map(item=>Array.isArray(item)?[...item]:item&&{...item});},
    dispose(){menus.clear();}
  };
}
