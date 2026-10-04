export {DependencyPropertyRegistry, PropertyFault, UnsetValue} from '../dependency-property.js';
export {PropertyMetadata, normalizePropertyMetadata} from './metadata.js';
export {validatePropertyValue, defaultPropertyValue} from './validation.js';
export {PropertyStore, ValueSource} from './property-store.js';
export {ChangeNotificationQueue} from '../observable/change-queue.js';
export {registerBuiltInAttachedProperties} from './attached.js';
export {propertyValuesEqual} from './value-equality.js';
export {EffectiveValueEmitter} from './change-emitter.js';
