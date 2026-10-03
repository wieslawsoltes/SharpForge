import { typeKeywords } from './core.js';
export const typeMethods = {
  parseName() { let name = this.expect('identifier').value; while (this.match('.')) name += '.' + this.expect('identifier').value; return name; },
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
};
