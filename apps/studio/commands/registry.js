export function createCommandRegistry(){
  const commands=new Map();
  return {
    registerCommand(id,title,shortcut,handler,{visible=true,enabled=true}={}){
      if(typeof id!=='string'||!id||typeof title!=='string'||typeof shortcut!=='string'||typeof handler!=='function')throw new TypeError('Malformed command');
      if(commands.has(id))throw new Error('Duplicate command '+id);
      const entry=Object.freeze({id,title,shortcut,handler,visible,enabled});commands.set(id,entry);
      return ()=>{if(commands.get(id)===entry)commands.delete(id);};
    },
    async execute(id,...args){
      const command=commands.get(id);
      if(!command)throw new Error('Unknown command '+id);
      if(!(typeof command.enabled==='function'?command.enabled(id,...args):command.enabled))throw new Error('Command is unavailable: '+command.title);
      return command.handler(id,...args);
    },
    canExecute(id,...args){
      const command=commands.get(id);
      return !!command&&(typeof command.enabled==='function'?!!command.enabled(id,...args):!!command.enabled);
    },
    list(){return [...commands.values()].filter(command=>command.visible).map(({id,title,shortcut})=>[id,title,shortcut]);},
    dispose(){commands.clear();}
  };
}
