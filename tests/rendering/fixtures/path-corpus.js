import {fluentPaths} from '../vendor/fluent-icons/paths.js';

/** One hundred distinct paths: pinned Fluent assets plus every SVG/WinUI command family and fill mode. */
export function pathCorpus() {
  const fixtures = fluentPaths.map(value => ({...value, source: 'F1 ' + value.svg}));
  for (let index = 0; index < 97; index++) {
    const x = index % 11, y = index % 7, a = 8 + index % 9, b = 5 + index % 13;
    const paths = [
      `M${x} ${y}h${a}v${b}h${-a}z`,
      `M${x} ${y} ${x + a} ${y + b} ${x + a * 2} ${y}Z`,
      `m${x} ${y}c${a} 0 ${a} ${b} ${a * 2} ${b}s${a} ${-b} ${a * 2} 0z`,
      `M${x} ${y}Q${x + a} ${y + b * 2} ${x + a * 2} ${y}T${x + a * 4} ${y}Z`,
      `M${x} ${y}q${a} ${b * 2} ${a * 2} 0t${a * 2} 0z`,
      `M${x} ${y}A${a} ${b} 30 0 1 ${x + a * 2} ${y + b}L${x} ${y}z`,
      `m${x} ${y}a${a} ${b} 45 1 0 ${a * 2} ${b}a${a} ${b} 45 0 1 ${-a * 2} ${-b}z`,
      `M${x},${y}H${x + a * 3}V${y + b * 3}H${x}Z M${x + 2},${y + 2}h${a}v${b}h${-a}Z`,
      `M${x} ${y}h${a * 3}v${b * 3}h${-a * 3}z m2 2v${b}h${a}v${-b}z`,
      `M${x} ${y}L${x + a} ${y + b}L${x} ${y + b}L${x + a} ${y}Z`,
      `M${x}.5 ${y}.25C${x + a} ${y + b * 3} ${x + a * 2} ${y - b} ${x + a * 3} ${y + b}Z`,
      `M${x}e0 ${y}e0l${a}e0-.5 ${a}e0 ${b}e0z`,
      `M${x} ${y}h${a}v${b}q0 2-2 2h${2 - a}z M${x + a * 2} ${y}l${a} ${b} ${a} ${-b}z`,
      `M${x} ${y}A${a} ${b} 0 01${x + a * 2} ${y}A${a} ${b} 0 11${x} ${y}Z`
    ];
    const svg = paths[index % paths.length], fillRule = index & 1 ? 'nonzero' : 'evenodd';
    fixtures.push({id: `grammar-${index}`, svg, source: `${index & 1 ? 'F1' : 'F0'} ${svg}`, fillRule});
  }
  return fixtures;
}
