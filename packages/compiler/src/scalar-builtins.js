import {Op,Builtins,NumericType,numericMode,numericIntrinsicDefinitions,numericTypeName,integerType,float as scalarFloat,decimalParse} from '@sharpforge/bytecode';
import {numeric,implicitNumeric,constantFits} from './numeric.js';

const pathOf=node=>node?.kind==='Name'?node.name:node?.kind==='Member'&&pathOf(node.target)?pathOf(node.target)+'.'+node.name:null;
const short=type=>type?.endsWith('&')?short(type.slice(0,-1))+'&':type==='System.Object'?'object':type==='System.String'?'string':numericTypeName(type);
const owners={decimal:'System.Decimal',Decimal:'System.Decimal',Math:'System.Math',Convert:'System.Convert',BitConverter:'System.BitConverter',Console:'System.Console',object:'System.Object',Object:'System.Object'};
const fields={Zero:'0',One:'1',MinusOne:'-1',MinValue:'-79228162514264337593543950335',MaxValue:'79228162514264337593543950335'};
const builtinFor=descriptor=>Builtins.find(builtin=>builtin.numeric===descriptor);

/** Typed source calls share the descriptor-only CLI profile and scalar conversions. */
export function installScalarCompiler(C) {
  const originalExpr=C.prototype.expr,originalInfer=C.prototype.infer,originalTyped=C.prototype.typedExpr;
  Object.assign(C.prototype,{
    scalarStaticOwner(node) {
      const path=pathOf(node);if(!path||this.lookup(path.split('.')[0])||this.c.typeMap.has(path))return null;
      return owners[path]??(Object.values(owners).includes(path)?path:null);
    },
    scalarConstant(node) {
      if(node?.kind!=='Member')return null;
      const path=pathOf(node.target);if(!path||this.lookup(path.split('.')[0])||this.c.typeMap.has(path))return null;
      const type=short(path==='Decimal'?'decimal':path==='Single'?'float':path==='Double'?'double':path);
      if(type==='decimal'&&fields[node.name]!==undefined)return {type,value:decimalParse(fields[node.name])};
      if(['float','double'].includes(type)) {
        const values={NaN:NaN,PositiveInfinity:Infinity,NegativeInfinity:-Infinity,MaxValue:type==='float'?3.4028234663852886e38:Number.MAX_VALUE,MinValue:type==='float'?-3.4028234663852886e38:-Number.MAX_VALUE,Epsilon:type==='float'?2**-149:Number.MIN_VALUE};
        if(Object.hasOwn(values,node.name))return {type,value:scalarFloat(values[node.name],type==='float'?'r4':'r8')};
      }
      const integer=integerType(type);
      if(integer&&!integer.native&&numeric(type)&&['MinValue','MaxValue'].includes(node.name)) {
        const bits=BigInt(integer.bits),value=node.name==='MinValue'?(integer.unsigned?0n:-(1n<<(bits-1n))):(1n<<(integer.unsigned?bits:bits-1n))-1n;
        return {type,value:{scalar:type,value:String(value)}};
      }
      return null;
    },
    scalarAccepts(node,target,actual=this.infer(node)) {
      target=short(target);actual=short(actual);
      if(target===actual)return true;
      if(numeric(target)&&numeric(actual)){if(implicitNumeric(actual,target))return true;const constant=this.constant(node);return !!constant&&constantFits(constant.value,constant.type,target);}
      return this.frameworkConversion?.(target,actual)??false;
    },
    scalarString(type){const parameter=['nint','nuint'].includes(type)?'object':type;const descriptor=numericIntrinsicDefinitions.find(d=>d.owner==='System.Convert'&&d.name==='ToString'&&short(d.parameters[0])===parameter&&(d.formatType??null)===(['nint','nuint'].includes(type)?type:null));this.emit(Op.BUILTIN,builtinFor(descriptor).id,1);return 'string';},
    scalarBinding(node,report=false) {
      const ctor=node?.kind==='New';if(!ctor&&node?.kind!=='Call')return null;
      let owner=ctor?(this.c.typeMap.has(node.type)?null:owners[node.type]??(Object.values(owners).includes(node.type)?node.type:null)):this.scalarStaticOwner(node.target?.target),receiver=null;
      if(!owner&&!ctor&&node.target?.kind==='Member'&&short(this.infer(node.target.target))==='decimal'){owner='System.Decimal';receiver=node.target.target;}
      if(!owner)return null;
      const name=ctor?'.ctor':node.target.name;
      let templates=numericIntrinsicDefinitions.filter(d=>d.owner===owner&&d.name===name&&(ctor?!d.isStatic:d.isStatic===!receiver)&&d.parameters.length===node.args.length);
      if((owner==='System.Console'||owner==='System.Convert'&&name==='ToString')&&node.args.length===1) {
        const actual=short(this.infer(node.args[0])),parameter=owner==='System.Console'&&['sbyte','byte','short','ushort'].includes(actual)?'int':['nint','nuint'].includes(actual)?'object':actual==='decimal'?'decimal':actual==='null'?'string':numeric(actual)||['bool','string'].includes(actual)?actual:'object';
        templates=templates.filter(d=>short(d.parameters[0])===parameter&&(d.formatType??null)===(['nint','nuint'].includes(actual)?actual:null));
      }
      if(!templates.length)return null;
      const candidates=templates.filter(d=>d.parameters.every((parameter,index)=>{
        const argument=node.args[index],target=short(parameter);
        if(target.endsWith('&'))return argument?.kind==='RefArgument'&&argument.modifier==='out'&&short(this.infer(argument.expression))===target.slice(0,-1);
        return argument?.kind!=='RefArgument'&&this.scalarAccepts(argument,target);
      }));
      const score=d=>d.parameters.reduce((sum,t,i)=>sum+(short(t)===short(this.infer(node.args[i]))?0:1),0);
      const better=(a,b)=>a.parameters.every((type,i)=>short(type)===short(b.parameters[i])||numeric(short(type))&&numeric(short(b.parameters[i]))&&implicitNumeric(short(type),short(b.parameters[i])));
      candidates.sort((a,b)=>score(a)-score(b)||(better(a,b)?-1:better(b,a)?1:0));
      if(!candidates.length){if(report)this.c.report(node,'CS1501',`No supported ${owner}.${name} overload accepts these arguments`);return {error:true};}
      if(candidates.length>1&&score(candidates[0])===score(candidates[1])&&!better(candidates[0],candidates[1])){if(report)this.c.report(node,'CS0121','Ambiguous scalar overload');return {error:true};}
      return {descriptor:candidates[0],receiver,result:ctor?short(owner):short(candidates[0].returnType)};
    },
    emitScalarCall(node,binding) {
      if(binding.error){this.emitConstant(null);return 'error';}
      if(binding.receiver)this.expr(binding.receiver);
      const assigned=[];
      node.args.forEach((argument,index)=>{
        const target=short(binding.descriptor.parameters[index]);
        if(target.endsWith('&')){this.synchronizationAddress(argument.expression,{out:true});if(argument.expression.kind==='Name'){const local=this.lookup(argument.expression.name);if(local)assigned.push(local.slot);}}
        else this.checkAssign(target,this.typedExpr(argument,target),argument);
      });
      this.emit(Op.BUILTIN,builtinFor(binding.descriptor).id,node.args.length+Number(!!binding.receiver));
      for(const slot of assigned)this.assigned.add(slot);
      return binding.result;
    },
    scalarConditionalType(node) {
      const yes=short(this.infer(node.whenTrue)),no=short(this.infer(node.whenFalse));if(!numeric(yes)||!numeric(no))return null;
      if(yes===no)return yes;
      const left=this.constant(node.whenTrue),right=this.constant(node.whenFalse);
      if(left&&constantFits(left.value,left.type,no))return no;if(right&&constantFits(right.value,right.type,yes))return yes;
      if(this.scalarAccepts(node.whenFalse,yes,no))return yes;
      if(this.scalarAccepts(node.whenTrue,no,yes))return no;
      return null;
    },
    scalarConditional(node,type) {
      this.bool(node.condition);const before=new Set(this.assigned),no=this.emit(Op.JFALSE);
      this.checkAssign(type,this.typedExpr(node.whenTrue,type),node.whenTrue);const yesAssigned=new Set(this.assigned),done=this.emit(Op.JUMP);
      this.patch(no);this.assigned=new Set(before);this.checkAssign(type,this.typedExpr(node.whenFalse,type),node.whenFalse);
      this.assigned=new Set([...yesAssigned].filter(slot=>this.assigned.has(slot)));this.patch(done);return type;
    },
    typedExpr(node,type) {
      type=short(type);
      if(node?.kind==='Conditional'&&numeric(type))return this.scalarConditional(node,type);
      const actual=originalTyped.call(this,node,type);
      if(numeric(type)&&numeric(actual)&&actual!==type&&this.scalarAccepts(node,type,actual)){this.emit(Op.CONVERT,NumericType[type],numericMode(actual,false));return type;}
      return actual;
    },
    infer(node) {
      const constant=this.scalarConstant(node);if(constant)return constant.type;
      if(node?.kind==='New'&&short(node.type)==='decimal'&&node.args.length===0)return 'decimal';
      const binding=this.scalarBinding(node);if(binding)return binding.error?'error':binding.result;
      if(node?.kind==='Conditional'){const type=this.scalarConditionalType(node);if(type)return type;}
      return originalInfer.call(this,node);
    },
    expr(node) {
      if(node?.kind==='Call'&&node.args.length===0&&node.target?.kind==='Member'&&node.target.name==='ToString'){const type=short(this.infer(node.target.target));if(numeric(type)&&type!=='decimal'){this.expr(node.target.target);return this.scalarString(type);}}
      const constant=this.scalarConstant(node);if(constant){this.emitConstant(constant.value,constant.type);return constant.type;}
      if(node?.kind==='New'&&short(node.type)==='decimal'&&node.args.length===0){this.emitConstant(decimalParse('0'),'decimal');return 'decimal';}
      const binding=this.scalarBinding(node,true);if(binding)return this.emitScalarCall(node,binding);
      if(node?.kind==='Conditional'){const type=this.scalarConditionalType(node);if(type)return this.scalarConditional(node,type);}
      return originalExpr.call(this,node);
    }
  });
}
