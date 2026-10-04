import {Op} from '@sharpforge/bytecode';
import {requireProjectReference} from './project-reference-errors.js';
import {appendProjectMethod, emitProjectCode as emit} from './project-graph-method.js';

/** Preserve precise library initialization at local and external call/allocation sites without shifting original PCs. */
export function projectCallWrappers(image, limit, ensureInitialized) {
  const methods = new Map();
  const allocations = new Map();
  function method(binding) {
    if (!binding.module.source.typeInitializers.has(binding.type.source.name)) {
      return binding.module.offsets.methods + binding.source.id;
    }
    const key = binding.module.key + ':' + binding.source.id;
    if (methods.has(key)) return methods.get(key);
    const parameters = [...(binding.source.isStatic ? [] : [binding.module.mapType(binding.type.source.name)]),
      ...binding.source.parameters.map(parameter => binding.module.mapType(parameter.type))];
    const id = appendProjectMethod(image, binding, {name: '<project-call-' + binding.source.id + '>', parameters,
      returnType: binding.module.mapType(binding.source.returnType)}, code => {
      ensureInitialized(code, binding);
      parameters.forEach((parameter, index) => emit(code, Op.LDLOC, index));
      emit(code, Op.CALL, binding.module.offsets.methods + binding.source.id, parameters.length);
      emit(code, Op.RET);
    });
    requireProjectReference(image.methods.length <= limit, 'PRJ0006', 'linked method adapter count');
    methods.set(key, id);
    return id;
  }
  function allocate(module, typeId) {
    const source = module.image.types[typeId];
    if (!module.source.typeInitializers.has(source.name)) return null;
    const key = module.key + ':' + typeId;
    if (allocations.has(key)) return allocations.get(key);
    const binding = {module, type: {source}};
    const id = appendProjectMethod(image, binding, {name: '<project-allocate-' + typeId + '>', parameters: [],
      returnType: module.mapType(source.name)}, code => {
      ensureInitialized(code, binding);
      emit(code, Op.NEWOBJ, module.offsets.types + typeId);
      emit(code, Op.RET);
    });
    requireProjectReference(image.methods.length <= limit, 'PRJ0006', 'linked allocation adapter count');
    allocations.set(key, id);
    return id;
  }
  return {method, allocate};
}
