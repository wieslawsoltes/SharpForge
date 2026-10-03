import { typeKeywords } from './core.js';
export const statementMethods = {
  block() {
    const start=this.expect('{'),statements=[];
    if(++this.depth>200){this.error(this.current,'SF1099','Syntax nesting limit exceeded');while(!this.at('eof'))this.take();this.depth--;return this.node('Block',start,{statements});}
    while(!this.at('}')&&!this.at('eof')){const before=this.i;statements.push(this.statement());this.guardProgress(before);}
    this.expect('}');this.depth--;return this.node('Block',start,{statements});
  },
  isLocal() {
    let i=this.i;if(this.tokens[i]?.kind==='const')i++;
    if(!typeKeywords.has(this.tokens[i]?.kind)&&this.tokens[i]?.kind!=='identifier')return false;i++;
    while(this.tokens[i]?.kind==='.'&&this.tokens[i+1]?.kind==='identifier')i+=2;
    if(this.tokens[i]?.kind==='<'){let depth=0,steps=0;do{const k=this.tokens[i++]?.kind;depth+=k==='<'?1:k==='>'?-1:k==='>>'?-2:0;if(++steps>128)return false;}while(depth>0&&this.tokens[i]?.kind!=='eof');}while(this.tokens[i]?.kind==='['&&this.tokens[i+1]?.kind===']')i+=2;
    return this.tokens[i]?.kind==='identifier'&&['=',';',',',')'].includes(this.tokens[i+1]?.kind);
  },
  local(semicolon=true) {
    const start=this.current,isConst=!!this.match('const'),type=this.type(),declarations=[];
    do {const id=this.expect('identifier'),initializer=this.match('=')?this.expression():null;declarations.push(this.node('Variable',id,{name:id.value,nameSpan:{start:id.start,end:id.end},type,initializer,isConst}));}while(this.match(','));
    if(semicolon)this.expect(';');return this.node('Local',start,{declarations});
  },
  statement() {
    const start=this.current;
    if(['checked','unchecked'].includes(this.current.kind)&&this.peek().kind==='{'){const context=this.take();return this.node('OverflowContext',context,{checked:context.kind==='checked',body:this.block()});}if(this.at('{'))return this.block();
    if(this.at('identifier')&&this.peek().kind===':'){const label=this.take();this.take();return this.node('Labeled',start,{label:label.value,body:this.statement()});}
    if(this.match(';'))return this.node('Empty',start);
    if(this.match('using')){if(this.match('(')){const resources=this.isLocal()?this.local(false):this.expression();this.expect(')');return this.node('Using',start,{resources,body:this.statement()});}const resources=this.local();return this.node('UsingDeclaration',start,{resources});}
    if(this.match('if')){this.expect('(');const condition=this.expression();this.expect(')');const then=this.statement(),otherwise=this.match('else')?this.statement():null;return this.node('If',start,{condition,then,otherwise});}
    if(this.match('switch')){this.expect('(');const expression=this.expression();this.expect(')');this.expect('{');const sections=[];while(!this.at('}')&&!this.at('eof')){const before=this.i,sectionStart=this.current,labels=[],statements=[];while(this.at('case')||this.at('default')){const label=this.take();labels.push(label.kind==='default'?null:this.expression());this.expect(':');}if(!labels.length)this.error(this.current,'CS1525','case or default expected');while(!['case','default','}','eof'].includes(this.current.kind)){const at=this.i;statements.push(this.statement());this.guardProgress(at);}sections.push(this.node('SwitchSection',sectionStart,{labels,statements}));this.guardProgress(before);}this.expect('}');return this.node('Switch',start,{expression,sections});}
    if(this.match('while')){this.expect('(');const condition=this.expression();this.expect(')');return this.node('While',start,{condition,body:this.statement()});}
    if(this.match('do')){const body=this.statement();this.expect('while');this.expect('(');const condition=this.expression();this.expect(')');this.expect(';');return this.node('Do',start,{condition,body});}
    if(this.match('for')){this.expect('(');const init=this.at(';')?null:this.isLocal()?this.local(false):this.expression();this.expect(';');const condition=this.at(';')?null:this.expression();this.expect(';');const increment=this.at(')')?null:this.expression();this.expect(')');return this.node('For',start,{init,condition,increment,body:this.statement()});}
    if(this.match('foreach')){this.expect('(');const type=this.type(),id=this.expect('identifier');this.expect('in');const expression=this.expression();this.expect(')');return this.node('Foreach',start,{type,name:id.value,nameSpan:{start:id.start,end:id.end},expression,body:this.statement()});}
    if(this.match('return')){const expression=this.at(';')?null:this.expression();this.expect(';');return this.node('Return',start,{expression});}
    if(this.match('break')||this.match('continue')){const label=this.at('identifier')?this.take().value:null;this.expect(';');return this.node(start.kind==='break'?'Break':'Continue',start,{label});}
    if(this.match('throw')){const expression=this.at(';')?null:this.expression();this.expect(';');return this.node('Throw',start,{expression});}
    if(this.match('try')){const body=this.block(),catches=[];while(this.match('catch')){let type='Exception',id=null;if(this.match('(')){type=this.type();if(this.at('identifier'))id=this.take();this.expect(')');}catches.push({type,name:id?.value,nameSpan:id?{start:id.start,end:id.end}:null,body:this.block()});}const finallyBody=this.match('finally')?this.block():null;if(!catches.length&&!finallyBody)this.error(start,'CS1524','A catch or finally clause is required');return this.node('Try',start,{body,catches,finallyBody});}
    if(this.isLocal())return this.local();
    const expression=this.expression();this.expect(';');return this.node('ExpressionStatement',start,{expression});
  }
};
