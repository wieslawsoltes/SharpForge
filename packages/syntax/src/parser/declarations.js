import { modifiers, typeKeywords } from './core.js';
export const declarationMethods = {
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
  },
  usingResource() {if(this.peek().kind==='(')return true;const previous=this.i;this.i++;const result=this.isLocal();this.i=previous;return result;},
  isClass() { let i = this.i; while (modifiers.has(this.tokens[i]?.kind)) i++; return this.tokens[i]?.kind === 'class'; },
  namespace(members, statements) {
    this.take();const previous=this.namespaceName,name=this.parseName();this.namespaceName=previous?previous+'.'+name:name; if (this.match(';')) return;
    this.expect('{');
    while (!this.at('}') && !this.at('eof')) { const before=this.i; if(this.isClass()) members.push(this.classDeclaration()); else if(this.at('namespace')) this.namespace(members,statements); else { this.error(this.current,'SF1010','Only classes and nested namespaces are supported here'); this.take(); } this.guardProgress(before); }
    this.expect('}');this.namespaceName=previous;
  },
  parseModifiers() { const result = []; while (modifiers.has(this.current.kind)) { const t=this.take(); result.push(t.kind); if (['virtual','override','abstract'].includes(t.kind)) this.error(t,'SF1011',`Modifier '${t.kind}' is not implemented in this profile`); } return result; },
  classDeclaration() {
    const start=this.current, mods=this.parseModifiers(); this.expect('class'); const id=this.expect('identifier');
    const interfaces=[];if(this.match(':')){do{const at=this.current,name=this.type();if(!['IDisposable','System.IDisposable'].includes(name))this.error(at,'SF1014','Only the IDisposable interface is supported by this class profile');else if(interfaces.length)this.error(at,'CS0528','Duplicate IDisposable interface');else interfaces.push('System.IDisposable');}while(this.match(','));}
    this.expect('{'); const members=[];
    while(!this.at('}')&&!this.at('eof')) {const before=this.i; if(this.isClass()){this.error(this.current,'SF1015','Nested classes are not implemented'); this.classDeclaration();} else members.push(this.methodOrField(id.value)); this.guardProgress(before);}
    this.expect('}'); return this.node('Class',start,{name:id.value,namespace:this.namespaceName,nameSpan:{start:id.start,end:id.end},modifiers:mods,members,interfaces});
  },
  looksLikeMethod() {
    let i=this.i; while(modifiers.has(this.tokens[i]?.kind)) i++;
    if(!typeKeywords.has(this.tokens[i]?.kind)&&this.tokens[i]?.kind!=='identifier')return false;
    i++; while(this.tokens[i]?.kind==='.'&&this.tokens[i+1]?.kind==='identifier')i+=2;
    if(this.tokens[i]?.kind==='<'){let depth=0,steps=0;do{const k=this.tokens[i++]?.kind;depth+=k==='<'?1:k==='>'?-1:k==='>>'?-2:0;if(++steps>128)return false;}while(depth>0&&this.tokens[i]?.kind!=='eof');}while(this.tokens[i]?.kind==='['&&this.tokens[i+1]?.kind===']')i+=2;
    return this.tokens[i]?.kind==='identifier'&&this.tokens[i+1]?.kind==='(';
  },
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
  },
  parameters() {
    this.expect('(');const result=[];
    while(!this.at(')')&&!this.at('eof')) {const before=this.i,start=this.current; if(['ref','out','in','params'].includes(this.current.kind))this.error(this.take(),'SF1017','Parameter modifiers are not implemented');const type=this.type(),id=this.expect('identifier');result.push(this.node('Parameter',start,{name:id.value,type,nameSpan:{start:id.start,end:id.end}}));if(!this.match(','))break;this.guardProgress(before);}
    this.expect(')');return result;
  }
};
