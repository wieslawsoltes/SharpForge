const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const messageObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Content-Length framing shared by LSP/DAP. Lengths count bytes, not UTF-16 code units. */
export function encodeProtocolMessage(message,{maxMessageBytes=64*1024*1024}={}){
  if(!messageObject(message))throw new TypeError('Protocol messages must be JSON objects');
  const body=encoder.encode(JSON.stringify(message));if(body.length>maxMessageBytes)throw new RangeError('Protocol message exceeds limit');
  const header=encoder.encode(`Content-Length: ${body.length}\r\n\r\n`),result=new Uint8Array(header.length+body.length);result.set(header);result.set(body,header.length);return result;
}
/** Incremental, bounded byte parser. A framing error poisons the reader until reset(). */
export class ProtocolMessageReader {
  constructor({maxMessageBytes=64*1024*1024,maxHeaderBytes=8192}={}){
    if(!Number.isSafeInteger(maxMessageBytes)||maxMessageBytes<1||!Number.isSafeInteger(maxHeaderBytes)||maxHeaderBytes<24)throw new RangeError('Invalid framing limits');
    this.maxMessageBytes=maxMessageBytes;this.maxHeaderBytes=maxHeaderBytes;this.reset();
  }
  reset(){this.buffer=new Uint8Array(Math.min(4096,this.maxMessageBytes+this.maxHeaderBytes));this.begin=0;this.end=0;this.scan=0;this.expected=null;this.failed=false;}
  feed(chunk){
    if(this.failed)throw new Error('Protocol reader is failed; reset it before reuse');
    try{
      if(chunk instanceof ArrayBuffer)chunk=new Uint8Array(chunk);if(!(chunk instanceof Uint8Array))throw new TypeError('Protocol input must be bytes');
      const remaining=this.end-this.begin;if(remaining+chunk.length>this.maxMessageBytes+this.maxHeaderBytes)throw new RangeError('Buffered protocol bytes exceed limit');
      if(this.end+chunk.length>this.buffer.length){if(this.begin){this.buffer.copyWithin(0,this.begin,this.end);this.end-=this.begin;this.scan-=this.begin;this.begin=0;}if(this.end+chunk.length>this.buffer.length){const size=Math.min(this.maxMessageBytes+this.maxHeaderBytes,Math.max(this.end+chunk.length,this.buffer.length*2)),next=new Uint8Array(size);next.set(this.buffer.subarray(0,this.end));this.buffer=next;}}
      this.buffer.set(chunk,this.end);this.end+=chunk.length;const messages=[];
      while(true){
        if(this.expected===null){let marker=-1;for(let i=Math.max(this.begin,this.scan);i+3<this.end;i++)if(this.buffer[i]===13&&this.buffer[i+1]===10&&this.buffer[i+2]===13&&this.buffer[i+3]===10){marker=i;break;}
          if(marker<0){if(this.end-this.begin>this.maxHeaderBytes)throw new RangeError('Protocol header exceeds limit');this.scan=Math.max(this.begin,this.end-3);break;}
          if(marker-this.begin+4>this.maxHeaderBytes)throw new RangeError('Protocol header exceeds limit');
          const bytes=this.buffer.subarray(this.begin,marker);if(bytes.some(b=>b>127))throw new Error('Protocol headers must be ASCII');
          const headers=decoder.decode(bytes).split('\r\n');let length=null;
          for(const line of headers){const at=line.indexOf(':');if(at<1)throw new Error('Malformed protocol header');const name=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
            if(name==='content-length'){if(length!==null||!/^\d+$/.test(value))throw new Error('Invalid or duplicate Content-Length');length=Number(value);}
            if(name==='content-type'&&/charset\s*=/i.test(value)&&!/charset\s*=\s*utf-?8(?:\s*;|\s*$)/i.test(value))throw new Error('Only UTF-8 protocol bodies are supported');
          }
          if(length===null||!Number.isSafeInteger(length)||length<1||length>this.maxMessageBytes)throw new RangeError('Missing or excessive Content-Length');this.expected=length;this.begin=marker+4;this.scan=this.begin;
        }
        if(this.end-this.begin<this.expected)break;
        const parsed=JSON.parse(decoder.decode(this.buffer.subarray(this.begin,this.begin+this.expected)));if(!messageObject(parsed))throw new Error('Protocol envelope must be an object');messages.push(parsed);this.begin+=this.expected;this.expected=null;this.scan=this.begin;
      }
      if(this.begin===this.end){this.begin=this.end=this.scan=0;}return messages;
    }catch(error){this.failed=true;throw error;}
  }
  finish(){if(this.failed||this.expected!==null||this.end!==this.begin)throw new Error('Incomplete or failed protocol stream');}
}
