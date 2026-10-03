import {resolve,dirname} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {ProtocolMessageReader,encodeProtocolMessage} from '../src/framing.js';
import {LanguageServer} from '../src/lsp.js';
import {DebugAdapter} from '../src/dap.js';
/** Local stdio host. Stdout contains protocol frames only; diagnostics use stderr. */
export function serveProtocol(kind){
  const reader=new ProtocolMessageReader(),cancelled=new Set();let tail=Promise.resolve(),ended=false,pumping=false,queued=0;
  const send=message=>{if(!message)return;const accepted=process.stdout.write(encodeProtocolMessage(message));if(!accepted)process.stdin.pause();};
  const service=kind==='dap'?new DebugAdapter({send}):new LanguageServer({send});
  process.stdout.on('drain',()=>{if(!ended)process.stdin.resume();});process.stdout.on('error',()=>{ended=true;service.session?.stop();process.stdin.destroy();});
  const pump=()=>{if(pumping||ended||!['running','waiting'].includes(service.session?.vm.state))return;const delay=service.session.vm.state==='waiting'?service.session.vm.scheduler.nextDelay():0;if(delay===null)return;pumping=true;setTimeout(()=>{pumping=false;if(ended)return;try{service.pump({instructionBudget:10000,timeBudgetMs:6});pump();}catch(error){process.stderr.write(error.message+'\n');service.session?.stop();}},Math.min(50,Math.max(0,delay)));};
  const failure=error=>{if(ended)return;ended=true;process.exitCode=1;process.stderr.write('Protocol error: '+error.message+'\n');service.session?.stop();process.stdin.destroy();};
  process.stdin.on('data',chunk=>{try{const messages=reader.feed(chunk);if(queued+messages.length>1000)throw new RangeError('Too many queued protocol messages');queued+=messages.length;for(const message of messages)if(message.method==='$/cancelRequest'){if(cancelled.size>=1000)cancelled.clear();cancelled.add(message.params?.id);}
    for(const message of messages)tail=tail.then(async()=>{queued--;if(ended)return;
      if(kind==='lsp'&&message.method==='exit'){ended=true;process.exitCode=service.shutdown?0:1;process.stdin.destroy();return;}
      if(kind==='lsp'&&message.id!==undefined&&cancelled.delete(message.id)){send({jsonrpc:'2.0',id:message.id,error:{code:-32800,message:'Request cancelled before dispatch'}});return;}
      if(kind==='dap'&&message.command==='launch'&&message.arguments?.program&&!message.arguments.assembly&&!message.arguments.image){
        try{const info=await stat(message.arguments.program);if(!info.isFile()||info.size>64*1024*1024)throw new Error('Launch program must be a managed file of at most 64 MiB');const bytes=await readFile(message.arguments.program);if(bytes.length>64*1024*1024)throw new Error('Launch file grew beyond the size limit');message.arguments={...message.arguments,assembly:bytes,managedIL:message.arguments.managedIL??true};
          const boundedFile=async path=>{const st=await stat(path);if(!st.isFile()||st.size>64*1024*1024)throw new Error('Symbol/source file exceeds size limit');const b=await readFile(path);if(b.length>64*1024*1024)throw new Error('Symbol/source file grew beyond size limit');return b;};
          if(message.arguments.pdbPath)message.arguments.pdb=await boundedFile(resolve(dirname(message.arguments.program),message.arguments.pdbPath));
          if(message.arguments.sourceFiles){const entries=Object.entries(message.arguments.sourceFiles);if(entries.length>1000)throw new Error('Too many source mappings');const sources={};for(const [uri,path]of entries)sources[uri]=await boundedFile(resolve(dirname(message.arguments.program),path));message.arguments.sources=sources;}
}
        catch(error){send({seq:++service.seq,type:'response',request_seq:message.seq,command:'launch',success:false,message:error.message});return;}
      }
      send(await service.handle(message));pump();
    }).catch(failure);
  }catch(error){failure(error);}});
  process.stdin.on('end',()=>{tail.then(()=>{if(!ended){try{reader.finish();}catch(error){failure(error);return;}ended=true;service.session?.stop();}});});
  process.stdin.on('error',failure);
  return service;
}
