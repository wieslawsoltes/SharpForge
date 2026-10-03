import assert from 'node:assert/strict';

// Copied into the isolated install by verify-packages; imports resolve only installed tarballs.
export async function smoke({api}) { assert.ok(Object.keys(api).length > 0); }

// Ordered integration steps share compiled fixtures, preserving the original smoke sequence.
export const smokeSteps = [
  {id: 'network:http-transports', order: 2230, async run(context) {
    const {compileToIL, VirtualMachine, CilVirtualMachine} = context;
    const {NetworkPolicy,HttpTransport,WebSocketClient,createBrowserCsp}=await import('@sharpforge/network');
    assert.equal(typeof WebSocketClient,'function');
    assert.throws(()=>new NetworkPolicy().check('https://example.com'));
    assert(createBrowserCsp().includes("'wasm-unsafe-eval'"));
    const {createServer}=await import('node:http');
    const server14=createServer((req,res)=>res.end('packed HTTP'));
    await new Promise(r=>server14.listen(0,'127.0.0.1',r));
    const origin14='http://127.0.0.1:'+server14.address().port,transport14=new HttpTransport({allowedOrigins:[origin14]});
    try{assert.equal((await transport14.request(origin14)).text,'packed HTTP');const hc14=compileToIL('using System.Net.Http;using System.Threading.Tasks;class P{static async Task Main(){using var c=new HttpClient();Console.WriteLine(await c.GetStringAsync('+JSON.stringify(origin14)+'));}}');assert(hc14.success,JSON.stringify(hc14.diagnostics));for(const VM of [VirtualMachine,CilVirtualMachine]){const hvm14=new VM(VM===VirtualMachine?hc14.image:hc14.assembly,{network:{allowedOrigins:[origin14]}});try{assert.equal((await hvm14.runAsync()).output,'packed HTTP\n');}finally{hvm14.stop();}}}finally{transport14.dispose();server14.closeAllConnections();await new Promise(r=>server14.close(r));}
  }},
];
