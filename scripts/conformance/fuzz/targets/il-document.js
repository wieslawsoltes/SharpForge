import { assembleILDocument, CilError, formatILDocument } from '@sharpforge/cil';
import { checkTextOutput, decodeText, runTextTarget, textSeed, TextTargetRejection } from './text-contract.js';
import { createILDocumentSeed, createILFloatingDocumentSeeds } from './text-il-seeds.js';

function createSeeds() {
  const document = createILDocumentSeed();
  return [
    textSeed('local-library', document),
    textSeed('literal-comment', document.replace(/ldstr 0x[\da-f]+[^\n]*/i, 'ldstr "λ // value" // comment')),
    ...createILFloatingDocumentSeeds().map(seed => textSeed(seed.name, seed.document)),
    textSeed('unknown-opcode', document.replace('ldstr ', 'unknown ')),
    textSeed('missing-image', '.assembly "TextFuzzSeed"\n'),
    textSeed('incomplete-method', document.slice(0, document.lastIndexOf('}'))),
  ];
}

function assembleInput(input, limits) {
  try {
    return assembleILDocument(decodeText(input), {
      maxCharacters: limits.maxInputBytes,
      maxUserStringBytes: Math.min(64 * 1024, limits.maxOutputBytes),
    });
  } catch (error) {
    if (error instanceof CilError) throw new TextTargetRejection('IL_DOCUMENT');
    throw error;
  }
}

function parse(input, limits) {
  const result = assembleInput(input, limits);
  limits.signal?.throwIfAborted();
  checkTextOutput(result.bytes, limits);
  const canonical = formatILDocument(result.bytes);
  checkTextOutput(canonical, limits);
  // Errors in generated text are parser/formatter disagreements, never malformed-input rejections.
  const roundtrip = assembleILDocument(canonical, {
    maxCharacters: limits.maxOutputBytes,
    maxUserStringBytes: Math.min(64 * 1024, limits.maxOutputBytes),
  });
  limits.signal?.throwIfAborted();
  checkTextOutput(roundtrip.bytes, limits);
  const formatted = formatILDocument(roundtrip.bytes);
  checkTextOutput(formatted, limits);
  if (canonical !== formatted) {
    throw new Error('IL document changed across the canonical roundtrip, including its image scaffold');
  }
  return { status: 'accepted', code: 'IL_DOCUMENT_EXACT_ROUNDTRIP' };
}

/** Rebuild and format the editable IL dialect without loading it into a VM or native process. */
export const target = {
  id: 'il-document',
  createSeeds,
  run(input, context) {
    return runTextTarget(input, context, parse);
  },
};
