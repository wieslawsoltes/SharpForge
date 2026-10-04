import { evaluateCondition, parseXml } from '@sharpforge/project-system';
import { checkTextOutput, decodeText, runTextTarget, textSeed } from './text-contract.js';
import { classifyConditionError, classifyXmlError } from './text-errors.js';

const conditionPrefix = 'condition:\n';

function createSeeds() {
  return [
    textSeed('minimal-project', '<Project Sdk="Microsoft.NET.Sdk"/>'),
    textSeed('conditional-project', '<Project><PropertyGroup Condition="\'$(Configuration)\' == \'Debug\'">'
      + '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'),
    textSeed('entities-and-cdata', '<Project><!-- local --><Value><![CDATA[<x>]]>&amp;&#x3bb;</Value></Project>'),
    textSeed('condition-boolean', conditionPrefix + "'$(Configuration)' == 'Debug' And !false"),
    textSeed('condition-exists', conditionPrefix + "Exists('Seed.cs') Or HasTrailingSlash('src/')"),
    textSeed('mismatched-tag', '<Project><ItemGroup></Project>'),
    textSeed('duplicate-attribute', '<Project Sdk="a" Sdk="b"/>'),
    textSeed('doctype-denied', '<!DOCTYPE Project><Project/>'),
    textSeed('condition-incomplete', conditionPrefix + "('Debug' == 'Debug'"),
  ];
}

function condition(source, limits) {
  const value = evaluateCondition(source, {
    properties: { Configuration: 'Debug', Platform: 'AnyCPU', TargetFramework: 'net10.0' },
    exists: path => path === 'Seed.cs' || path === 'src/',
  });
  checkTextOutput(value ? 'true' : 'false', limits);
}

function parse(input, limits) {
  const source = decodeText(input);
  if (source.startsWith(conditionPrefix)) {
    condition(source.slice(conditionPrefix.length), limits);
    return;
  }
  const root = parseXml(source, {
    maxLength: limits.maxInputBytes,
    maxNodes: Math.max(1, Math.min(2048, Math.floor(limits.maxOutputBytes / 64))),
    maxDepth: 32,
  });
  const pending = [root];
  while (pending.length) {
    limits.signal?.throwIfAborted();
    const node = pending.pop();
    if (Object.hasOwn(node.attributes, 'Condition')) condition(node.attributes.Condition, limits);
    pending.push(...node.children);
  }
  checkTextOutput(JSON.stringify(root), limits);
}

/** Parse XML plus its conditions as data; Exists consults only two fixed in-memory names. */
export const target = {
  id: 'msbuild-xml',
  createSeeds,
  run(input, context) {
    return runTextTarget(input, context, parse, error => classifyXmlError(error) ?? classifyConditionError(error));
  },
};
