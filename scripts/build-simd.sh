#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
clang --target=wasm32 -O3 -msimd128 -fno-builtin -ffp-contract=off -nostdlib \
  -Wl,--no-entry -Wl,--export-memory -Wl,--export=__heap_base \
  -Wl,--initial-memory=131072 -Wl,--max-memory=67108864 \
  packages/compute/native/kernels.c -o packages/compute/native/kernels.wasm
node --input-type=module - <<'JS'
import {readFile,writeFile} from 'node:fs/promises';
const bytes=await readFile('packages/compute/native/kernels.wasm');
await writeFile('packages/compute/src/wasm.js','// Generated from native/kernels.c; no external downloads.\nexport const SIMD_BASE64='+JSON.stringify(bytes.toString('base64'))+';\n');
JS
