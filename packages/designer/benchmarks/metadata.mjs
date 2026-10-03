import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import {designerPropertySchema, validateDesign} from '@sharpforge/designer';

const document = {version: 1, name: '500 controls', width: 960, height: 640, root: 'root', styles: {}, templates: {}, nodes: [
  {id: 'root', type: 'Canvas', properties: {}, children: Array.from({length: 500}, (_, index) => 'n' + index), events: {}},
  ...Array.from({length: 500}, (_, index) => ({id: 'n' + index, type: 'Button',
    properties: {Name: 'Button' + index, Width: 100, Height: 40, Content: 'Value'}, children: [], events: {}}))
]};

function measure(name, action) {
  const samples = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now();
    action();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return {name, medianMs: samples[3], p95Ms: samples[6], samplesMs: samples};
}

for (let index = 0; index < 100; index++) designerPropertySchema('Button');
const results = [measure('10000 Button schema lookups', () => {
  for (let index = 0; index < 10000; index++) designerPropertySchema('Button');
}), measure('500 Button document validation', () => validateDesign(document))];
console.log(JSON.stringify({node: process.version, platform: process.platform, cpu: cpus()[0]?.model, results}, null, 2));
