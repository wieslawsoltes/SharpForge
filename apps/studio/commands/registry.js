export function createCommandRegistry(){
  const commands=new Map();
  return {
    registerCommand(id,title,shortcut,handler,{visible=true}={}){
      if(typeof id!=='string'||!id||typeof title!=='string'||typeof shortcut!=='string'||typeof handler!=='function')throw new TypeError('Malformed command');
      if(commands.has(id))throw new Error('Duplicate command '+id);
      const entry=Object.freeze({id,title,shortcut,handler,visible});commands.set(id,entry);
      return ()=>{if(commands.get(id)===entry)commands.delete(id);};
    },
    async execute(id,...args){const command=commands.get(id);if(!command)throw new Error('Unknown command '+id);return command.handler(id,...args);},
    list(){return [...commands.values()].filter(command=>command.visible).map(({id,title,shortcut})=>[id,title,shortcut]);},
    dispose(){commands.clear();}
  };
}
