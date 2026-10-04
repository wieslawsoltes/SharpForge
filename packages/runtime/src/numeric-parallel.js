import {ComputePool} from '@sharpforge/compute';
import {taskResult} from '@sharpforge/framework';

/** Marshal parallel numeric work through the host-operation lifetime and completion boundaries. */
export function invokeParallelNumeric(platform, descriptor, values, readArray) {
  const a = new Float64Array(readArray(platform, values[0]).map(value => platform.native(value)));
  const b = values.length > 1 ? new Float64Array(readArray(platform, values[1]).map(value => platform.native(value))) : null;
  platform.computePool ??= new ComputePool(platform.options.compute ?? {});
  const target = taskResult(descriptor.result);
  return platform.hostOperations.start(target,
    signal => platform.computePool.execute(descriptor.operation, a, b, {signal}),
    value => {
      if (typeof value === 'number') return platform.managed(value, 'double');
      const out = platform.heap.array('double', value.length);
      platform.heap.withRoots([out], () => {
        platform.heap.get(out);
        for (let index = 0; index < value.length; index++) {
          platform.heap.writeElement(out, index, platform.managed(value[index], 'double'));
        }
      });
      return out;
    }, values, 'compute');
}
