function indexOf(key) {
  if (typeof key !== 'string' || key === '') return -1;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? index : -1;
}

/** Runtime-owned storage retains capacity; this boundary preserves the public ordinary Array contract. */
export function numericArrayView(slots) {
  return new Proxy(slots.values, {
    get(target, key, receiver) {
      if (!slots.enabled) return Reflect.get(target, key, receiver);
      if (key === 'length') return slots.length;
      const index = indexOf(key);
      return index < 0 ? Reflect.get(target, key, receiver) : slots.get(index);
    },
    set(target, key, value) {
      if (!slots.enabled) return Reflect.set(target, key, value);
      const index = indexOf(key);
      if (index >= 0 && index < slots.capacity) slots.set(index, value);
      else if (key === 'length') slots.resize(value);
      else {
        slots.disable();
        return Reflect.set(target, key, value);
      }
      return true;
    },
    has(target, key) {
      if (!slots.enabled) return Reflect.has(target, key);
      const index = indexOf(key);
      if (index < 0) return Reflect.has(target, key);
      return index < slots.length && !!slots.present[index] || Reflect.has(Object.getPrototypeOf(target), key);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      if (!slots.enabled) return keys;
      return keys.filter(key => {
        const index = indexOf(key);
        return index < 0 || index < slots.length && !!slots.present[index];
      });
    },
    deleteProperty(target, key) {
      const index = indexOf(key);
      if (!slots.enabled || index < 0) return Reflect.deleteProperty(target, key);
      slots.clear(index);
      return true;
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (!slots.enabled) return descriptor;
      if (key === 'length') return {...descriptor, value: slots.length};
      const index = indexOf(key);
      if (index < 0) return descriptor;
      if (index >= slots.length || !slots.present[index]) return undefined;
      return {...descriptor, value: slots.get(index)};
    },
    defineProperty(target, key, descriptor) {
      slots.disable();
      return Reflect.defineProperty(target, key, descriptor);
    },
    preventExtensions(target) {
      slots.disable();
      return Reflect.preventExtensions(target);
    },
    setPrototypeOf(target, prototype) {
      slots.disable();
      return Reflect.setPrototypeOf(target, prototype);
    }
  });
}
