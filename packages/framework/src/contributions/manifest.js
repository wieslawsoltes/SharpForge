import {createRegistry} from '../registry.js';
import {registerBclModules} from '@sharpforge/bcl-core';
import {registerCoreXaml} from './core-xaml.js';
import {registerCoreControls} from './core-controls.js';
import {registerCoreSystem} from './core-system.js';
import {registerCoreControls12} from './core-controls-12.js';
import {registerBcl, registerBclCollectionExtensions} from '../bcl-contracts.js';
import {registerWinUI13} from '../winui13-contracts.js';
import {registerRuntime14} from '../runtime14-contracts.js';
import {ioSerializationContribution} from './io-serialization.js';
import {numericTypeContribution} from './numeric.js';
/** Released ranges are exact; additions belong in an independently reserved area. */
export const contributionManifest=Object.freeze([
  ['core-xaml',0,84,registerCoreXaml],['core-controls',84,299,registerCoreControls],
  ['core-system',383,84,registerCoreSystem],['core-controls-12',467,328,registerCoreControls12],
  ['bcl',795,507,registerBcl],['winui13',1302,211,registerWinUI13],['runtime14',1513,231,registerRuntime14]
].map(([name,start,size,register])=>Object.freeze({name,start,size,register,legacy:true})));
/** A00-A29 blocks are stable regardless of the order modules are loaded. */
export const areaReservations=Object.freeze(Array.from({length:30},(_,i)=>Object.freeze({name:'A'+String(i).padStart(2,'0'),start:65536+i*65536,size:65536})));
export const idReservations=Object.freeze([...contributionManifest,...areaReservations]);

/** New BCL modules use A07's reserved block without editing a central dispatcher. */
export const bclExtensionContribution=Object.freeze({
  name:'A07', register:registry=>registerBclModules(registry,{group:'extensions'})
});

/** Collection additions use A08 independently of the core A07 reservation. */
export const collectionExtensionContribution=Object.freeze({name:'A08', register:registerBclCollectionExtensions});

/** Compose released and extension contracts through the same transactional registry. */
export function createFrameworkRegistry() {
  const registry=createRegistry({reservations:idReservations});
  registry.registerAll([
    ...contributionManifest,bclExtensionContribution,collectionExtensionContribution,ioSerializationContribution,
    numericTypeContribution
  ]);
  return registry;
}
