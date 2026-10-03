/** Bounded scanner for regular and verbatim interpolated strings. Offsets are UTF-16. */
export function scanInterpolated(text, start, report) {
  const verbatim=text.startsWith('$@"',start)||text.startsWith('@$"',start),prefix=verbatim?3:2;
  let i=start+prefix,literal='',parts=[],closed=false;
  const error=(at,msg)=>report(at,Math.max(1,i-at),'CS8076',msg);
  const push=()=>{if(literal){parts.push({text:literal});literal='';}};
  const escape=()=>{const at=i-1,ch=text[i++],simple={e:'\x1b',n:'\n',r:'\r',t:'\t','0':'\0',b:'\b',f:'\f',v:'\v','\\':'\\','"':'"',"'":"'"};if(Object.hasOwn(simple,ch))return simple[ch];if(ch==='u'){const h=text.slice(i,i+4);if(/^[\da-f]{4}$/i.test(h)){i+=4;return String.fromCharCode(parseInt(h,16));}}error(at,'Invalid escape in interpolated string');return ch??'';};
  while(i<text.length){let ch=text[i++];
    if(ch==='"'){if(verbatim&&text[i]==='"'){i++;literal+='"';continue;}closed=true;break;}
    if(!verbatim&&(ch==='\r'||ch==='\n')){i--;error(start,'Newline in interpolated string');break;}
    if(!verbatim&&ch==='\\'){literal+=escape();continue;}
    if(ch==='}'&&text[i]==='}'){i++;literal+='}';continue;}
    if(ch==='}'){error(i-1,'Closing brace must be escaped as }}');continue;}
    if(ch!=='{'){literal+=ch;continue;}
    if(text[i]==='{'){i++;literal+='{';continue;}
    push();const expressionStart=i;let depth=0,quote=null,quoteVerbatim=false,comma=-1,colon=-1,end=-1;
    while(i<text.length){ch=text[i];
      if(quote){if(ch===quote){if(quoteVerbatim&&text[i+1]==='"'){i+=2;continue;}quote=null;}else if(ch==='\\'&&!quoteVerbatim){i+=2;continue;}i++;continue;}
      if(text.startsWith('//',i)){while(i<text.length&&!['\r','\n'].includes(text[i]))i++;continue;}
      if(text.startsWith('/*',i)){const stop=text.indexOf('*/',i+2);if(stop<0){i=text.length;break;}i=stop+2;continue;}
      if(ch==='"'||ch==="'"){quote=ch;quoteVerbatim=text[i-1]==='@';i++;continue;}
      if('([{'.includes(ch)){if(++depth>200){error(i,'Interpolation nesting limit');break;}i++;continue;}
      if(ch==='}'&&!depth){end=i++;break;}
      if(')]}'.includes(ch)){depth--;if(depth<0){error(i,'Unbalanced interpolation expression');break;}i++;continue;}
      if(!depth&&colon<0&&ch===','&&comma<0)comma=i;
      if(!depth&&colon<0&&ch===':'&&text[i-1]!==':'&&text[i+1]!==':')colon=i;
      if(colon>=0){i++;while(i<text.length&&text[i]!=='}'){if(text[i]==='{')error(i,'Format specifier cannot contain {');i++;}end=i;if(text[i]==='}')i++;break;}
      i++;
    }
    if(end<0){error(expressionStart,'Unclosed interpolation');break;}
    const expressionEnd=Math.min(...[comma,colon,end].filter(x=>x>=0));
    const alignment=comma<0?0:text.slice(comma+1,colon>=0?colon:end).trim();
    if(comma>=0&&!/^[+-]?\d+$/.test(alignment))error(comma,'Alignment must be a signed integer constant');
    const align=Number(alignment);if(!Number.isInteger(align)||Math.abs(align)>100000)error(comma,'Interpolation alignment limit exceeded');
    parts.push({expression:text.slice(expressionStart,expressionEnd),start:expressionStart,end:expressionEnd,alignment:Number.isInteger(align)?align:0,format:colon<0?'':text.slice(colon+1,end)});
    if(parts.length>10000){error(start,'Interpolation part limit exceeded');break;}
  }
  push();if(!closed)error(start,'Unterminated interpolated string');return {end:i,parts};
}
