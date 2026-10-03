// Run: node examples/registries/contributions.mjs
import {createRegistry} from '@sharpforge/framework';
import {createServiceRegistry} from '../../apps/studio/services/registry.js';
import {createCommandRegistry} from '../../apps/studio/commands/registry.js';
const framework=createRegistry({reservations:[{name:'example',start:900000,size:32}]});
framework.register({name:'example',register({define,member}){define('Example.Counter');member('Example.Counter','Increment',[],'int');}});
const services=createServiceRegistry();
const commands=services.register('commands',createCommandRegistry,r=>r.dispose());
let count=0;commands.registerCommand('increment','Increment counter','',()=>++count);
console.log({contract:framework.contracts[0],result:await commands.execute('increment')});
services.dispose();
