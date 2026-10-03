/** One command definition serves menus, palettes and shortcuts. */
export class CommandRegistry {
 constructor(){this.commands=new Map();}
 register(command){if(!command||typeof command.id!=='string'||!command.id||typeof command.execute!=='function')throw new TypeError('A command needs an id and execute callback');if(this.commands.has(command.id))throw new Error('Duplicate command '+command.id);this.commands.set(command.id,{...command});return()=>this.commands.delete(command.id);}
 describe(id,context={}){const command=this.commands.get(id);if(!command)return null;const enabled=typeof command.enabled==='function'?command.enabled(context):command.enabled!==false;return {...command,enabled:enabled===true,disabledReason:typeof enabled==='string'?enabled:command.disabledReason,checked:typeof command.checked==='function'?command.checked(context):command.checked};}
 async execute(id,context={}){const command=this.describe(id,context);if(!command)throw new Error('Unknown command '+id);if(!command.enabled)throw new Error(command.disabledReason??'Command is not available in this context');return command.execute(context);}
 search(query='',context={}){const terms=query.toLowerCase().trim().split(/\s+/);return [...this.commands.keys()].map(id=>this.describe(id,context)).filter(c=>terms.every(t=>(c.label+' '+c.id).toLowerCase().includes(t)));}
}
