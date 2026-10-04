import {Op, Binary, projectReferenceLimits} from '@sharpforge/bytecode';
import {appendProjectMethod, emitProjectCode as emit} from './project-graph-method.js';
import {requireProjectReference} from './project-reference-errors.js';

/** Adapt real library .cctor bodies to the source VM's explicit, per-session initialization model. */
export function projectInitializers(image) {
  const guards = new Map();
  const constant = value => {
    const index = image.constants.length;
    image.constants.push(value);
    return index;
  };
  function initializer(binding) {
    const {module, type} = binding;
    const ensure = module.source.ensure.get(type.source.name);
    if (ensure) return module.offsets.methods + ensure.id;
    const constructor = module.source.typeInitializers.get(type.source.name);
    if (!constructor) return null;
    const key = module.key + ':' + type.source.id;
    if (guards.has(key)) return guards.get(key);
    const initialized = image.statics.length;
    const failure = initialized + 1;
    const owner = module.mapType(type.source.name);
    image.statics.push({name: owner + '.<project-initialized>', type: 'bool', value: false, assemblyKey: module.key},
      {name: owner + '.<project-initialization-error>', type: 'object', value: null, assemblyKey: module.key});
    requireProjectReference(image.statics.length <= projectReferenceLimits.fields, 'PRJ0006', 'initialization state field count');
    const id = appendProjectMethod(image, binding, {name: '<project-initialize>', parameters: [], returnType: 'void'}, (code, method) => {
      method.locals.push({slot: 0, name: 'initializationError', type: 'object'});
      emit(code, Op.LDSTATIC, initialized);
      emit(code, Op.JTRUE, 12);
      emit(code, Op.CONST, constant(true));
      emit(code, Op.STSTATIC, initialized);
      emit(code, Op.POP);
      emit(code, Op.CALL, module.offsets.methods + constructor.id, 0);
      emit(code, Op.RET);
      emit(code, Op.LDLOC, 0);
      emit(code, Op.STSTATIC, failure);
      emit(code, Op.POP);
      emit(code, Op.LDLOC, 0);
      emit(code, Op.THROW);
      emit(code, Op.LDSTATIC, failure);
      emit(code, Op.CONST, constant(null));
      emit(code, Op.BINARY, Binary['==']);
      emit(code, Op.JTRUE, 18);
      emit(code, Op.LDSTATIC, failure);
      emit(code, Op.THROW);
      emit(code, Op.CONST, constant(null));
      emit(code, Op.RET);
      method.handlers.push({start: 5, end: 6, target: 7, slot: 0, type: 'Exception'});
    });
    requireProjectReference(image.methods.length <= projectReferenceLimits.methods, 'PRJ0006', 'initialization method count');
    guards.set(key, id);
    return id;
  }
  return (code, binding) => {
    const id = initializer(binding);
    if (id === null) return;
    emit(code, Op.CALL, id, 0);
    emit(code, Op.POP);
  };
}
