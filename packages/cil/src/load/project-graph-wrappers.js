import {Op} from '@sharpforge/bytecode';
import {requireProjectReference} from './project-reference-errors.js';
import {appendProjectMethod as createWrapper, emitProjectCode as emit} from './project-graph-method.js';
import {projectInitializers} from './project-graph-initialization.js';
import {projectCallWrappers} from './project-graph-call-wrappers.js';

/** Synthetic source call adapters preserve caller instruction offsets and real CIL constructor semantics. */
export function projectWrappers(image, limit) {
  const ensureInitialized = projectInitializers(image);
  const constructors = new Map();
  const staticFields = new Map();
  function constructor(binding) {
    const key = binding.module.key + ':' + binding.descriptor.token;
    if (constructors.has(key)) return constructors.get(key);
    const parameters = binding.descriptor.parameters;
    const returnType = binding.module.mapType(binding.type.source.name);
    const id = createWrapper(image, binding, {name: '<project-new-' + binding.descriptor.token + '>', parameters, returnType},
      (code, method) => {
        ensureInitialized(code, binding);
        const objectSlot = method.locals.length;
        method.locals.push({slot: objectSlot, name: 'instance', type: returnType});
        emit(code, Op.NEWOBJ, binding.module.offsets.types + binding.type.source.id);
        emit(code, Op.STLOC, objectSlot);
        emit(code, Op.POP);
        const initializer = binding.type.source.initializer;
        if (initializer !== undefined) {
          emit(code, Op.LDLOC, objectSlot);
          emit(code, Op.CALL, binding.module.offsets.methods + initializer, 1);
          emit(code, Op.POP);
        }
        if (binding.source) {
          emit(code, Op.LDLOC, objectSlot);
          parameters.forEach((parameter, index) => emit(code, Op.LDLOC, index));
          emit(code, Op.CALL, binding.module.offsets.methods + binding.source.id, parameters.length + 1);
          emit(code, Op.POP);
        }
        emit(code, Op.LDLOC, objectSlot);
        emit(code, Op.RET);
      });
    requireProjectReference(image.methods.length <= limit, 'PRJ0006', 'linked method and constructor-adapter count');
    constructors.set(key, id);
    return id;
  }
  function staticField(binding, store) {
    const key = binding.module.key + ':' + binding.descriptor.token + ':' + store;
    if (staticFields.has(key)) return staticFields.get(key);
    const type = binding.descriptor.fieldType;
    const parameters = store ? [type] : [];
    const id = createWrapper(image, binding, {name: '<project-' + (store ? 'set-' : 'get-') + binding.descriptor.token + '>',
      parameters, returnType: type}, code => {
        ensureInitialized(code, binding);
        if (store) emit(code, Op.LDLOC, 0);
        emit(code, store ? Op.STSTATIC : Op.LDSTATIC, binding.module.offsets.statics + binding.index);
        emit(code, Op.RET);
      });
    requireProjectReference(image.methods.length <= limit, 'PRJ0006', 'linked method and field-adapter count');
    staticFields.set(key, id);
    return id;
  }
  return {constructor, staticField, ...projectCallWrappers(image, limit, ensureInitialized)};
}
