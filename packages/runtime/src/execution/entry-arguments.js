import { entryArgumentValues, validateProgramArguments, RuntimeLaunchError } from '../launch-options.js';

/** Root the argv array while strings allocate, then retain it through the entry frame's locals. */
export function sourceEntryArguments(vm, options) {
  const parameters = vm.image.methods[vm.image.entryPoint].parameters.map(parameter => parameter.type);
  const input = entryArgumentValues(parameters, options);
  if (input.length !== parameters.length) throw new RuntimeLaunchError('METHOD_ARGUMENTS', 'Argument count does not match the entry method');
  if (!parameters.length) return [];
  if (parameters.length !== 1 || parameters[0] !== 'string[]') {
    throw new RuntimeLaunchError('PROGRAM_ENTRY_SIGNATURE', 'Source programs support an entry argument of type string[]');
  }
  const values = validateProgramArguments(input[0]);
  const reference = vm.heap.array('string', values.length);
  vm.heap.withRoots([reference], () => {
    const data = vm.heap.get(reference).data;
    for (let index = 0; index < values.length; index++) data[index] = vm.heap.string(values[index]);
  });
  return [reference];
}

/** Selected CIL methods retain their existing typed marshaling and raw parameter-vector contract. */
export function cilEntryArguments(vm, entry, options) {
  const parameters = entry.signature.parameters;
  const input = entryArgumentValues(parameters, options);
  if (input.length !== parameters.length) throw new RuntimeLaunchError('METHOD_ARGUMENTS', 'Argument count does not match selected method');
  const args = [];
  vm.heap.withRoots(args, () => {
    for (let index = 0; index < input.length; index++) {
      const value = vm.marshal(input[index], parameters[index]);
      args.push(value);
      vm.heap.pins.push(value);
    }
  });
  return args;
}
