import { SourceText, diagnostic } from '@sharpforge/text';
import { lex } from './lexer.js';
const modifiers = new Set(['public','private','protected','internal','static','readonly','const','sealed','partial','virtual','override','abstract','async']);
const typeKeywords = new Set(['int','double','float','bool','string','object','char','void','var','long','decimal','uint','ulong','short','byte']);
const precedence = { '??=':1, '=':1, '+=':1, '-=':1, '*=':1, '/=':1, '%=':1, '&=':1, '|=':1, '^=':1, '??':3, '||':4, '&&':5, '|':6, '^':7, '&':8, '==':9, '!=':9, '<':10, '>':10, '<=':10, '>=':10, 'is':10, 'as':10, '<<':11, '>>':11, '+':12, '-':12, '*':13, '/':13, '%':13 };
export class Parser {
  constructor(lexed) { Object.assign(this, lexed); this.diagnostics = [...lexed.diagnostics]; this.i = 0; this.depth = 0; this.nodeCount = 0; this.namespaceName=''; }
  get current() { return this.tokens[this.i]; }
  at(k) { return this.current.kind === k; }
  peek(n = 1) { return this.tokens[Math.min(this.tokens.length - 1, this.i + n)]; }
  take() { const t = this.current; if (!this.at('eof')) this.i++; return t; }
  match(k) { return this.at(k) ? this.take() : null; }
  error(t, code, message) { if (this.diagnostics.length < 200) this.diagnostics.push(diagnostic(this.source, t.start, Math.max(1, t.end - t.start), code, message)); }
  expect(k) { if (this.at(k)) return this.take(); this.error(this.current, 'CS1003', `'${k}' expected`); return {kind:k, start:this.current.start, end:this.current.start, text:'', value:'', missing:true}; }
  node(kind, start, props = {}) { this.nodeCount++; return { kind, start: typeof start === 'number' ? start : start.start, end: this.tokens[Math.max(0, this.i - 1)].end, uri:this.source.uri, ...props }; }
  guardProgress(before) { if (before === this.i && !this.at('eof')) { this.error(this.current, 'CS1525', `Unexpected token '${this.current.text}'`); this.take(); } }
  parse() {
    const members = [], statements = []; const start = this.current;
    while (!this.at('eof')) {
      const before = this.i;
      if (this.at('using')&&!this.usingResource()) { this.take(); while (!this.at(';') && !this.at('eof')) this.take(); this.expect(';'); }
      else if (this.at('namespace')) this.namespace(members, statements);
      else if (this.isClass()) members.push(this.classDeclaration());
      else if (this.looksLikeMethod()) members.push(this.methodOrField(null));
      else statements.push(this.statement());
      this.guardProgress(before);
    }
    return { source:this.source, tokens:this.tokens, root:this.node('CompilationUnit', start, { members, statements }), diagnostics:this.diagnostics, internedTokenHits:this.internedTokenHits, nodeCount:this.nodeCount };
  }
  usingResource(){if(this.peek().kind==='(')return true;const previous=this.i;this.i++;const result=this.isLocal();this.i=previous;return result;}
  isClass() { let i = this.i; while (modifiers.has(this.tokens[i]?.kind)) i++; return this.tokens[i]?.kind === 'class'; }
  namespace(members, statements) {
    this.take();const previous=this.namespaceName,name=this.parseName();this.namespaceName=previous?previous+'.'+name:name; if (this.match(';')) return;
    this.expect('{');
    while (!this.at('}') && !this.at('eof')) { const before=this.i; if(this.isClass()) members.push(this.classDeclaration()); else if(this.at('namespace')) this.namespace(members,statements); else { this.error(this.current,'SF1010','Only classes and nested namespaces are supported here'); this.take(); } this.guardProgress(before); }
    this.expect('}');this.namespaceName=previous;
  }
  parseModifiers() { const result = []; while (modifiers.has(this.current.kind)) { const t=this.take(); result.push(t.kind); if (['virtual','override','abstract'].includes(t.kind)) this.error(t,'SF1011',`Modifier '${t.kind}' is not implemented in this profile`); } return result; }
  parseName() { let name = this.expect('identifier').value; while (this.match('.')) name += '.' + this.expect('identifier').value; return name; }
  type() {
    const t = this.current; let name;
    if (typeKeywords.has(t.kind)) name=this.take().kind;
    else if (this.at('identifier')) name=this.parseName();
    else { this.error(t,'CS1031','Type expected'); name='error'; if(![';',')',',','}','eof'].includes(t.kind)) this.take(); }
    if(this.match('<')){if(!/^(?:System\.(?:(?:Threading\.Tasks|Collections\.Generic|Numerics)\.)?)?(?:Task|Action|Func|List|Dictionary|HashSet|Queue|Stack|Vector)$/.test(name))this.error(t,'SF1012','Only registered closed framework generic types are supported');const args=[];do{args.push(this.type());}while(this.match(','));if(this.at('>>')){const token=this.current;this.tokens.splice(this.i,1,{...token,kind:'>',text:'>',end:token.start+1},{...token,kind:'>',text:'>',start:token.start+1});}this.expect('>');name+='<'+args.join(', ')+'>'; }
    while (this.at('[') && this.peek().kind === ']') { this.take(); this.take(); name += '[]'; }
    if (this.match('?')) this.error(t,'SF1013','Nullable type annotations are not implemented');
    return name;
  }
  classDeclaration() {
    const start=this.current, mods=this.parseModifiers(); this.expect('class'); const id=this.expect('identifier');
    const interfaces=[];if(this.match(':')){do{const at=this.current,name=this.type();if(!['IDisposable','System.IDisposable'].includes(name))this.error(at,'SF1014','Only the IDisposable interface is supported by this class profile');else if(interfaces.length)this.error(at,'CS0528','Duplicate IDisposable interface');else interfaces.push('System.IDisposable');}while(this.match(','));}
    this.expect('{'); const members=[];
    while(!this.at('}')&&!this.at('eof')) {const before=this.i; if(this.isClass()){this.error(this.current,'SF1015','Nested classes are not implemented'); this.classDeclaration();} else members.push(this.methodOrField(id.value)); this.guardProgress(before);}
    this.expect('}'); return this.node('Class',start,{name:id.value,namespace:this.namespaceName,nameSpan:{start:id.start,end:id.end},modifiers:mods,members,interfaces});
  }
  looksLikeMethod() {
    let i=this.i; while(modifiers.has(this.tokens[i]?.kind)) i++;
    if(!typeKeywords.has(this.tokens[i]?.kind)&&this.tokens[i]?.kind!=='identifier')return false;
    i++; while(this.tokens[i]?.kind==='.'&&this.tokens[i+1]?.kind==='identifier')i+=2;
    if(this.tokens[i]?.kind==='<'){let depth=0,steps=0;do{const k=this.tokens[i++]?.kind;depth+=k==='<'?1:k==='>'?-1:k==='>>'?-2:0;if(++steps>128)return false;}while(depth>0&&this.tokens[i]?.kind!=='eof');}while(this.tokens[i]?.kind==='['&&this.tokens[i+1]?.kind===']')i+=2;
    return this.tokens[i]?.kind==='identifier'&&this.tokens[i+1]?.kind==='(';
  }
  methodOrField(owner) {
    const start=this.current, mods=this.parseModifiers();
    if(owner&&this.at('identifier')&&this.current.value===owner&&this.peek().kind==='(') {const id=this.take(), parameters=this.parameters(); return this.node('Method',start,{name:'.ctor',nameSpan:{start:id.start,end:id.end},returnType:'void',parameters,body:this.block(),modifiers:mods,owner});}
    const type=this.type(), id=this.expect('identifier');
    if(this.at('(')) {
      const parameters=this.parameters(); let body;
      if(this.match('=>')) {const expr=this.expression();this.expect(';');body=this.node('Block',expr,{statements:[this.node(type==='void'?'ExpressionStatement':'Return',expr,{expression:expr})]});}
      else body=this.block();
      return this.node('Method',start,{name:id.value,nameSpan:{start:id.start,end:id.end},returnType:type,parameters,body,modifiers:mods,owner});
    }
    if(this.at('{')||this.at('=>')) {
      const accessors=[];
      if(this.match('=>')){const expression=this.expression();this.expect(';');accessors.push(this.node('Accessor',id,{name:'get',modifiers:[],body:this.node('Block',expression,{statements:[this.node('Return',expression,{expression})]})}));}
      else {this.expect('{');while(!this.at('}')&&!this.at('eof')){const before=this.i,at=this.current,modifiers=this.parseModifiers(),kind=this.take();
        if(!['get','set'].includes(kind.kind))this.error(kind,'CS1014','A get or set accessor is expected (init is not supported in this profile)');
        let body=null;
        if(!this.match(';')){if(this.match('=>')){const expression=this.expression();this.expect(';');body=this.node('Block',expression,{statements:[this.node(kind.kind==='get'?'Return':'ExpressionStatement',expression,{expression})]});}else body=this.block();}
        accessors.push(this.node('Accessor',at,{name:kind.kind,modifiers,body}));this.guardProgress(before);
      }this.expect('}');}
      const initializer=this.match('=')?this.expression():null;if(initializer)this.expect(';');
      return this.node('Property',start,{name:id.value,nameSpan:{start:id.start,end:id.end},type,accessors,initializer,modifiers:mods,owner});
    }
    const initializer=this.match('=')?this.expression():null; this.expect(';');
    return this.node('Field',start,{name:id.value,nameSpan:{start:id.start,end:id.end},type,initializer,modifiers:mods,owner});
  }
  parameters() {
    this.expect('(');const result=[];
    while(!this.at(')')&&!this.at('eof')) {const before=this.i,start=this.current; if(['ref','out','in','params'].includes(this.current.kind))this.error(this.take(),'SF1017','Parameter modifiers are not implemented');const type=this.type(),id=this.expect('identifier');result.push(this.node('Parameter',start,{name:id.value,type,nameSpan:{start:id.start,end:id.end}}));if(!this.match(','))break;this.guardProgress(before);}
    this.expect(')');return result;
  }
  block() {
    const start=this.expect('{'),statements=[];
    if(++this.depth>200){this.error(this.current,'SF1099','Syntax nesting limit exceeded');while(!this.at('eof'))this.take();this.depth--;return this.node('Block',start,{statements});}
    while(!this.at('}')&&!this.at('eof')){const before=this.i;statements.push(this.statement());this.guardProgress(before);}
    this.expect('}');this.depth--;return this.node('Block',start,{statements});
  }
  isLocal() {
    let i=this.i;if(this.tokens[i]?.kind==='const')i++;
    if(!typeKeywords.has(this.tokens[i]?.kind)&&this.tokens[i]?.kind!=='identifier')return false;i++;
    while(this.tokens[i]?.kind==='.'&&this.tokens[i+1]?.kind==='identifier')i+=2;
    if(this.tokens[i]?.kind==='<'){let depth=0,steps=0;do{const k=this.tokens[i++]?.kind;depth+=k==='<'?1:k==='>'?-1:k==='>>'?-2:0;if(++steps>128)return false;}while(depth>0&&this.tokens[i]?.kind!=='eof');}while(this.tokens[i]?.kind==='['&&this.tokens[i+1]?.kind===']')i+=2;
    return this.tokens[i]?.kind==='identifier'&&['=',';',',',')'].includes(this.tokens[i+1]?.kind);
  }
  local(semicolon=true) {
    const start=this.current,isConst=!!this.match('const'),type=this.type(),declarations=[];
    do {const id=this.expect('identifier'),initializer=this.match('=')?this.expression():null;declarations.push(this.node('Variable',id,{name:id.value,nameSpan:{start:id.start,end:id.end},type,initializer,isConst}));}while(this.match(','));
    if(semicolon)this.expect(';');return this.node('Local',start,{declarations});
  }
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
  }
  prefix() {
    const t=this.take();
    if(t.kind==='interpolated'){
      const parts=t.value.map(part=>{if(part.text!==undefined)return {...part};const inner=lex(new SourceText(part.expression,this.source.uri)),p=new Parser({...inner,source:this.source,tokens:inner.tokens.map(x=>({...x,start:x.start+part.start,end:x.end+part.start,fullStart:x.fullStart+part.start})),diagnostics:[]});const expression=p.expression();if(!p.at('eof'))p.error(p.current,'CS1003','Unexpected trailing interpolation input');for(const d of inner.diagnostics)this.error({start:part.start,end:part.end},d.code,d.message);this.diagnostics.push(...p.diagnostics);return {...part,expression};});return this.node('InterpolatedString',t,{parts});
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
  }
  arrayInitializer(){this.expect('{');const values=[];while(!this.at('}')&&!this.at('eof')){values.push(this.expression());if(!this.match(','))break;}this.expect('}');return values;}
}
export function parse(source, cache) { return new Parser(lex(typeof source==='string'?new SourceText(source):source, cache)).parse(); }
export function parseExpression(text) { const p=new Parser(lex(new SourceText(text,'<expression>'))); const expression=p.expression();if(!p.at('eof'))p.error(p.current,'CS1003','Unexpected trailing input');return {expression,diagnostics:p.diagnostics}; }
export function walk(node, visit) { if(!node||typeof node!=='object')return; if(node.kind)visit(node);for(const [key,value] of Object.entries(node)){if(['source','tokens','nameSpan','symbol'].includes(key))continue;if(Array.isArray(value))for(const v of value)walk(v,visit);else if(value&&typeof value==='object')walk(value,visit);} }
