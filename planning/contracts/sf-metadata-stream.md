# SharpForge #SF stream v1

PE/CLI metadata root contains a normal stream header named ASCII `#SF` with NUL termination and four-byte header alignment. Header offset and size delimit UTF-8 JSON bytes with no BOM or internal prefix. The stream is emitted by MetadataBuilder.finish only when emitAssemblyDetailed receives includeDebug=true. false omits it completely; this does not remove Portable PDB data when separately requested.

Root record: format="SharpForge.CIL", version=1, framework (net8/mscorlib4), name, entry (source method ID or null), optional outputKind="library", types (source id, metadata token, initializer), statics (field tokens), methods (source-to-IL spans and method/local metadata), sequencePoints (source fields plus ilOffset and methodToken), sources (uri,version, optional embedded text). Ordering is the emitted order; maps resolve explicit IDs, not array positions unless the loader explicitly verifies them.

Readers reject unknown required versions, invalid IDs/tokens/ranges, malformed JSON, inconsistent spans and size/count limits. Optional inspectors may report a diagnostic and continue without debug data; execution through loadAssembly requires a valid supported #SF profile. Direct CilVirtualMachine can execute its supported CIL subset without #SF. The stream is debugging/profile metadata, not an alternate executable bytecode payload.

Tests emit real PE files with includeDebug true/false and inspect metadata streams. Semantic body/identity schemas are separate versioned interchange artifacts; adding them does not silently redefine the legacy #SF layout.
