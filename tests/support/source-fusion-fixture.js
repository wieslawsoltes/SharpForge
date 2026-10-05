import {FORMAT_VERSION, Op, Binary} from '@sharpforge/bytecode';

/** Small verified source IR fixtures exercise exact instruction and fault boundaries. */
export function sourceFusionFixture({operator = '+', mode = 1, entry = false} = {}) {
  const code = [];
  const emit = (op, a = 0, b = 0) => code.push(op, a, b);
  const locals = ['left', 'right', 'result'].map((name, slot) => ({name, slot, type: 'int'}));
  if (entry) {
    emit(Op.CONST, 0);
    emit(Op.JUMP, 3);
    emit(Op.LDLOC, 0);
    emit(Op.LDLOC, 1);
    emit(Op.BINARY, Binary[operator], mode);
    emit(Op.RET);
  } else {
    emit(Op.LDLOC, 0);
    emit(Op.LDLOC, 1);
    emit(Op.BINARY, Binary[operator], mode);
    emit(Op.STLOC, 2);
    emit(Op.POP);
    emit(Op.LDLOC, 2);
    emit(Op.CONST, 1);
    emit(Op.BINARY, Binary['+'], 1);
    emit(Op.STLOC, 2);
    emit(Op.POP);
    emit(Op.LDLOC, 2);
    emit(Op.LDLOC, 1);
    emit(Op.BINARY, Binary['>'], 1);
    emit(Op.JFALSE, 16);
    emit(Op.CONST, 2);
    emit(Op.RET);
    emit(Op.CONST, 3);
    emit(Op.RET);
  }
  return {
    formatVersion: FORMAT_VERSION, name: 'SourceFusion', entryPoint: 0,
    constants: [6, 1, 42, -1], types: [], statics: [], sequencePoints: [], sources: [],
    methods: [{id: 0, name: 'Main', qualifiedName: 'Main', owner: null, isStatic: true,
      parameters: [], returnType: 'int', locals, handlers: [], code: Int32Array.from(code)}]
  };
}
