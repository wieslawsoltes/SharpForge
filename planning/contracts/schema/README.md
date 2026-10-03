# Metadata schema 1

Pinned signature vocabulary: ECMA-335 sixth edition (June 2012), II.23.2. Type identity preserves assembly scope, named generic arity/instantiation, array rank, byref/pointer, generic parameters, function pointers and custom modifiers. Method signatures preserve convention, this flags, generic arity, result, parameters and vararg sentinel. Semantic arity/convention checks live in adapters.js in addition to JSON structure validation.

Source spans use UTF-16 half-open offsets and one-based line/columns. Offset is IL byte offset for a PDB/source-to-IL point and bytecode instruction offset for source image points; the owning method encoding defines the unit. Hidden points have null source offsets and zero coordinates; no fabricated offsets are supplied when external PDB sources are unavailable. Portable PDB's 0xFEEFEE hidden line maps to hidden=true. Tests cover committed external Portable PDB and emitted source points.

Method bodies now lower both encodings to a typed, common operation vocabulary. Worklist propagation resolves instruction input/output types and stack states using declared signatures/locals, field and call metadata, builtin contracts, and control-flow joins. All branch, exception and safepoint offsets use instruction indices. Original offsets/opcodes remain as provenance; retained storage signatures preserve narrow integer, bool and float storage semantics. `typeState: resolved` is emitted only after all blocks and handlers type-check. `validateBody(body,{requireExecutable:true})` rejects unresolved records, falsified stack effects and inconsistent successors. The three required source/CIL programs are completely resolved, including compiler-generated helpers and unreachable cleanup epilogues. See method-body.md for lowering semantics and explicitly rejected operations.

Bytecode image schema applies to JSON.parse(serializeImage(image)), including {$int32:[words]} code. Semantic verifier-only checks: length divisible by three, opcode membership, stack-height flow, branch/constant/method/field indices, entry point resolution, handler slot and instruction ranges. Structural schema validation is required before deserializeImage (which would otherwise coerce numbers into Int32). Root schemaVersion/formatVersion negotiation must precede semantic use.

Golden generator is deterministic, uses fixed source fixture files and excludes elapsed times/tool timestamps. CI entry is tests/a00-05-metadata.test.js; `node scripts/planning/gen-schema-fixtures.js --check` compares committed bytes. JS validator accepts only the documented schema subset and fails on unknown keywords. Rust reader independently checks the same subset with locked dependencies; it is schema qualification only, not Rust runtime qualification.

The integrated A05 runtime corrects `GC.GetTotalMemory` to an Int64 result.
Bytecode format 2 and `bytecode-image.v2.schema.json` describe this changed
builtin signature while retaining every numeric ID. Format 1 schema remains
available for archival structural validation; the current interpreter rejects
format 1 images, which must be recompiled. The Rust structural reader checks the
version constant declared by the selected schema.
