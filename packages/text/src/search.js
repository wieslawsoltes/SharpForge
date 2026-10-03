/** Bounded literal search. Offsets are UTF-16, even when case folding changes length. */
export function findTextMatches(documents,query,{matchCase=false,wholeWord=false,maxMatches=2000,signal}={}) {
  if(typeof query!=='string'||query.length>1024)throw new RangeError('Search text must be a string of at most 1024 characters');
  if(!Number.isInteger(maxMatches)||maxMatches<1||maxMatches>10000)throw new RangeError('Match limit must be between 1 and 10000');
  const matches=[];let scannedFiles=0;if(!query)return {matches,truncated:false,scannedFiles};
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escape(query),matchCase?'gu':'giu'),word=/[\p{L}\p{N}\p{M}_]/u;
  const before=(text,at)=>{let start=at-1;if(start>0&&text.charCodeAt(start)>=0xdc00&&text.charCodeAt(start)<=0xdfff)start--;return text.slice(Math.max(0,start),at);};
  const after=(text,at)=>at<text.length?String.fromCodePoint(text.codePointAt(at)):'';
  for(const document of documents){if(signal?.aborted)throw new DOMException('Search cancelled','AbortError');const {uri,text,version}=document;if(typeof text!=='string'||typeof uri!=='string')throw new TypeError('Search documents require URI and text');scannedFiles++;pattern.lastIndex=0;let match,line=0,lineStart=0,last=0;
    while((match=pattern.exec(text))){if(signal?.aborted)throw new DOMException('Search cancelled','AbortError');const start=match.index,end=start+match[0].length;if(wholeWord&&(word.test(before(text,start))||word.test(after(text,end))))continue;
      if(matches.length===maxMatches)return {matches,truncated:true,scannedFiles};
      for(let at=last;at<start;at++)if(text[at]==='\n'){line++;lineStart=at+1;}last=start;
      const nextLine=text.indexOf('\n',start),lineEnd=nextLine<0?text.length:nextLine;
      matches.push({uri,start,end,version,line,character:start-lineStart,preview:text.slice(lineStart,Math.min(lineEnd,lineStart+240)).replace(/\r$/,'')});
    }
  }
  return {matches,truncated:false,scannedFiles};
}
