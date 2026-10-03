import { SourceText } from '@sharpforge/text';
import { lex } from '../lexer.js';
import { precedence, typeKeywords } from './core.js';
export const expressionMethods = {
  expression(min=0) {
    if(++this.depth>200){this.error(this.current,'SF1099','Expression nesting limit exceeded');this.take();this.depth--;return this.node('Error',this.current);}
    let left=this.prefix();
    for(;;){
      if(this.at('(')&&16>=min){const start=left;this.take();const args=[];while(!this.at(')')&&!this.at('eof')){const before=this.i;args.push(this.expression());if(!this.match(','))break;this.guardProgress(before);}this.expect(')');left=this.node('Call',start,{target:left,args});continue;}
      if(this.match('?.')){const id=this.expect('identifier');left=this.node('ConditionalMember',left,{target:left,name:id.value,nameSpan:{start:id.start,end:id.end}});continue;}
      if(this.at('?')&&this.peek().kind==='['&&16>=min){this.take();this.take();const index=this.expression();this.expect(']');left=this.node('ConditionalIndex',left,{target:left,index});continue;}
      if(this.match('.')){const id=this.expect('identifier');left=this.node('Member',left,{target:left,name:id.value,nameSpan:{start:id.start,end:id.end}});continue;}
      if(this.at('[')&&16>=min){this.take();const index=this.expression();this.expect(']');left=this.node('Index',left,{target:left,index});continue;}
      if(['++','--'].includes(this.current.kind)&&16>=min){const op=this.take().kind;left=this.node('Unary',left,{operator:op,operand:left,postfix:true});continue;}
      if(this.at('switch')&&min<=2){this.take();this.expect('{');const arms=[];while(!this.at('}')&&!this.at('eof')){const before=this.i,armStart=this.current;const pattern=this.at('identifier')&&this.current.value==='_'?(this.take(),null):this.expression(2);this.expect('=>');const expression=this.expression();arms.push(this.node('SwitchArm',armStart,{pattern,expression}));if(!this.match(','))break;this.guardProgress(before);}this.expect('}');left=this.node('SwitchExpression',left,{expression:left,arms});continue;}
      if(this.at('?')&&min<=2){this.take();const whenTrue=this.expression();this.expect(':');const whenFalse=this.expression(2);left=this.node('Conditional',left,{condition:left,whenTrue,whenFalse});continue;}
      const op=this.current.kind,p=precedence[op];if(p===undefined||p<min)break;this.take();const right=this.expression(p+(p===1||op==='??'?0:1));left=this.node(p===1?'Assignment':'Binary',left,{operator:op,left,right});
    }
    this.depth--;return left;
  },
  prefix() {
    const t=this.take();
    if(t.kind==='interpolated'){
      const parts=t.value.map(part=>{if(part.text!==undefined)return {...part};const inner=lex(new SourceText(part.expression,this.source.uri)),p=new this.constructor({...inner,source:this.source,tokens:inner.tokens.map(x=>({...x,start:x.start+part.start,end:x.end+part.start,fullStart:x.fullStart+part.start})),diagnostics:[]});const expression=p.expression();if(!p.at('eof'))p.error(p.current,'CS1003','Unexpected trailing interpolation input');for(const d of inner.diagnostics)this.error({start:part.start,end:part.end},d.code,d.message);this.diagnostics.push(...p.diagnostics);return {...part,expression};});return this.node('InterpolatedString',t,{parts});
    }
    if(['integer','double','string','char','true','false','null'].includes(t.kind)&&!(['double','string','char'].includes(t.kind)&&t.text===t.kind))return this.node('Literal',t,{value:t.kind==='true'?true:t.kind==='false'?false:t.kind==='null'?null:t.value,type:t.kind==='integer'?'int':t.kind==='true'||t.kind==='false'?'bool':t.kind});
    if(t.kind==='identifier'&&['Vector','List','HashSet','Queue','Stack','Dictionary','Task'].includes(t.value)&&this.at('<')){let at=this.i,depth=0;do{const k=this.tokens[at++]?.kind;depth+=k==='<'?1:k==='>'?-1:k==='>>'?-2:0;}while(depth>0&&at<this.tokens.length);if(depth===0&&this.tokens[at]?.kind==='.'){this.i--;const name=this.type();return this.node('Name',t,{name,nameSpan:{start:t.start,end:this.tokens[this.i-1].end}});}}
    if(['identifier','this','base'].includes(t.kind)||typeKeywords.has(t.kind))return this.node('Name',t,{name:t.value??t.kind,escaped:t.text.startsWith('@'),nameSpan:{start:t.start,end:t.end}});
    if(t.kind==='unchecked'||t.kind==='checked'){this.expect('(');const expression=this.expression();this.expect(')');return this.node(t.kind==='checked'?'Checked':'Unchecked',t,{expression});}
    if(t.kind==='await')return this.node('Await',t,{expression:this.expression(14)});
    if(t.kind==='default'){this.expect('(');const type=this.type();this.expect(')');return this.node('Default',t,{type});}
    if(t.kind==='('&&['int','double'].includes(this.current.kind)&&this.peek().kind===')'){const type=this.take().kind;this.take();return this.node('Cast',t,{type,expression:this.expression(14)});}
    if(t.kind==='('){const expression=this.expression();this.expect(')');return expression;}
    if(['!','~','-','+','++','--'].includes(t.kind))return this.node('Unary',t,{operator:t.kind,operand:this.expression(14),postfix:false});
    if(t.kind==='['){
      const elements=[];let arguments_=null;
      if(this.at('identifier')&&this.current.value==='with'&&this.peek().kind==='('){this.take();this.take();arguments_=[];while(!this.at(')')&&!this.at('eof')){let name=null;if(this.at('identifier')&&this.peek().kind===':'){name=this.take().value;this.take();}arguments_.push({name,expression:this.expression()});if(!this.match(','))break;}this.expect(')');if(!this.at(']'))this.expect(',');}
      while(!this.at(']')&&!this.at('eof')){const at=this.current,spread=!!this.match('..'),expression=this.expression();elements.push(spread?this.node('SpreadElement',at,{expression}):expression);if(!this.match(','))break;}this.expect(']');return this.node('CollectionExpression',t,{elements,arguments:arguments_});
    }
    if(t.kind==='new'){
      let type=this.at('(')?'<target>':this.at('[')?'var':this.type();
      if(this.match('[')){const length=this.at(']')?null:this.expression();this.expect(']');type+='[]';let values=null;if(this.at('{'))values=this.arrayInitializer();return this.node('NewArray',t,{type,length,values});}
      if(type.endsWith('[]')){const values=this.at('{')?this.arrayInitializer():[];return this.node('NewArray',t,{type,length:null,values});}
      const args=[];if(!this.at('{')){this.expect('(');while(!this.at(')')&&!this.at('eof')){args.push(this.expression());if(!this.match(','))break;}this.expect(')');}
      const initializers=[],collectionInitializers=[];
      if(this.match('{')){const object=this.at('identifier')&&this.peek().kind==='=';while(!this.at('}')&&!this.at('eof')){const before=this.i;if(object){const id=this.expect('identifier');this.expect('=');initializers.push(this.node('Initializer',id,{name:id.value,nameSpan:{start:id.start,end:id.end},expression:this.expression()}));}else if(this.match('{')){const values=[];while(!this.at('}')&&!this.at('eof')){values.push(this.expression());if(!this.match(','))break;}this.expect('}');collectionInitializers.push(values);}else collectionInitializers.push([this.expression()]);if(!this.match(','))break;this.guardProgress(before);}this.expect('}');}
      return this.node('New',t,{type,args,initializers,collectionInitializers});
    }
    this.error(t,'CS1525',`Invalid expression term '${t.text}'`);return this.node('Error',t);
  },
  arrayInitializer() {this.expect('{');const values=[];while(!this.at('}')&&!this.at('eof')){values.push(this.expression());if(!this.match(','))break;}this.expect('}');return values;}
};
