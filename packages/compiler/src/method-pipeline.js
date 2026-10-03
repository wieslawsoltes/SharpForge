import {Op} from '@sharpforge/bytecode';
import {MethodBodyBinder} from './binder/method-body.js';
import {WellKnownMembers} from './symbols/well-known-members.js';
import {lowerMethodBody} from './lowering/pipeline.js';
import {IrEmitter} from './codegen/ir-emitter.js';
import {analyzeMethodFlow} from './flow/method-flow.js';
/**
 * The bound-tree method pipeline: bind -> flow analysis -> lowering -> code generation.
 *
 * Binding and flow analysis run for every method first; lowering and IR generation run only when the compilation is
 * error-free, in declaration order, so the constant pool and sequence points are numbered as before.
 * Each unit keeps its binder and bound body so the semantic model can answer queries afterwards.
 */
export class BoundMethodPipeline {
  constructor(compilation){
    this.c=compilation;this.units=[];
    const root=()=>compilation.files[0]?.root??{};
    this.wellKnown=new WellKnownMembers(compilation.semantic.typeProvider,(node,code,args)=>compilation.report(node??root(),code,args));
    this.context={types:name=>compilation.semantic.typeOf(name),wellKnown:this.wellKnown,report:(node,code,args)=>compilation.report(node??root(),code,args)};
  }
  /** Binds and analyses the body of a declared method. */
  bindMethod(method){
    const binder=new MethodBodyBinder(this.c,method),body=binder.bindBody(),unit={kind:'body',method,binder,body};this.units.push(unit);
    unit.flow=analyzeMethodFlow(this.c,method,body,binder);return unit;
  }
  /**
   * Binds static field initializers into a synthesized method (a library .cctor or the startup method).
   * `ownerPerField` binds each initializer in the scope of its field's type; `tail(emitter)` emits what follows.
   */
  bindInitializers(method,fields,{ownerPerField=false,tail=null}={}){
    const binder=new MethodBodyBinder(this.c,method),owner=method.owner,initializers=[];
    for(const field of fields){if(ownerPerField)method.owner=field.owner;const value=binder.bindTyped(field.node.initializer,field.type);binder.checkAssign(field.type,value.legacyType,field.node);initializers.push({field,value});}
    if(ownerPerField)method.owner=owner;const unit={kind:'initializers',method,binder,initializers,tail};this.units.push(unit);return unit;
  }
  /** Lowers and emits every unit. Does nothing when the compilation has errors: no image is produced then. */
  emit(){
    if(this.c.diagnostics.some(d=>d.severity==='error'))return false;
    const lowered=this.units.map(unit=>unit.kind==='body'?{unit,body:lowerMethodBody(unit.body,{...this.context,method:unit.method})}:{unit,values:unit.initializers.map(i=>({field:i.field,value:lowerMethodBody(i.value,{...this.context,method:unit.method})}))});
    // Lowering can report a missing compiler-required member (CS0656); emit nothing in that case.
    if(this.c.diagnostics.some(d=>d.severity==='error'))return false;
    for(const {unit,body,values} of lowered){
      const emitter=new IrEmitter(this.c,unit.method);
      if(unit.kind==='body'){unit.lowered=body;emitter.build(body);continue;}
      for(const {field,value} of values){emitter.expr(value);emitter.emit(Op.STSTATIC,field.index);emitter.emit(Op.POP);}
      if(unit.tail)unit.tail(emitter);else{emitter.emitConstant(null);emitter.emit(Op.RET);}emitter.finish();
    }
    return true;
  }
}
