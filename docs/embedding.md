> **0.10 update:** [Advanced debugger and WinUI guide](advanced-debugging-winui.md) and [validation](validation-0.10.0.md) define the new symbol, async, live-editing and web-framework support; older limitations below describe the baseline unless explicitly superseded.

# Embedding the reusable packages

**0.8 update:** See [Explorer, menus, editor profiles and breakpoint workflows](explorer-keymaps.md) and [current validation](validation-0.8.0.md). Earlier feature sections below remain applicable within their stated limits.

The packages use standard ESM. In the source workspace, install the local packages once with `npm ci --offline --ignore-scripts --no-audit --no-fund`. For application integration, build/package each needed module and its sibling dependencies; this release does not publish package names to npm. Local tarballs are provided in `artifacts/` in the source archive.

## Versioned language services

```js
import { Workspace } from '@sharpforge/workspace';
import { LanguageService } from '@sharpforge/language';

const workspace = new Workspace();
workspace.update('Program.cs', 'int count=1;\nConsole.WriteLine(count);', 1);
const language = new LanguageService(workspace);
const result = workspace.compile();
console.log(result.diagnostics);
console.log(language.hover('Program.cs', 5));
console.log(language.rename('Program.cs', 5, 'amount'));

// Versions must increase. Equal or stale versions are ignored.
workspace.update('Program.cs', 'int count=2;\nConsole.WriteLine(count);', 2);
```

`Workspace.change(uri, changes, version)` accepts sequential LSP-shaped changes with zero-based UTF-16 ranges. `syntax(uri)` returns the document's cached parse. `compile()` returns the same result object until documents change. Treat returned syntax/results as read-only even where their objects are not deeply frozen.

To cancel before dispatch, pass `workspace.compile({signal})`. The synchronous compile is not preemptible inside a worker. Use versions and host request scheduling to discard obsolete work. Do not claim an old result belongs to a newly edited document.

## Running legacy serialized IR (explicit compatibility path)

```js
import { compile } from '@sharpforge/compiler';
import { serializeImage, deserializeImage, verifyImage } from '@sharpforge/bytecode';
import { VirtualMachine } from '@sharpforge/runtime';

const compiled = compile('Console.WriteLine(42);');
if (!compiled.success) throw new Error(compiled.diagnostics[0].message);
const storedText = serializeImage(compiled.image);
const restored = deserializeImage(storedText);
const verificationErrors = verifyImage(restored);
if (verificationErrors.length) throw new Error(verificationErrors.join('\n'));
const vm = new VirtualMachine(restored);
console.log(vm.run().output);
```

In a browser bundle, import the package names through your bundler. The supplied static distribution instead exposes relative modules such as `./packages/compiler/src/index.js`. The compiler does not touch the DOM and is suitable for a Worker.

## Compile and store real IL

```js
import { compileToIL } from '@sharpforge/compiler';
import { loadAssembly, formatAssembly } from '@sharpforge/cil';
import { VirtualMachine } from '@sharpforge/runtime';
import { DebugSession } from '@sharpforge/debugger';

const result = compileToIL('Console.WriteLine(6 * 7);', {
  name: 'Application',
  framework: 'net8',
  embedSources: true,
  includeDebug: true
});
if (!result.success) {
  throw new Error(result.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n'));
}

// Uint8Array: store in IndexedDB, write to disk or transfer to a worker.
const dll = result.assembly;
console.log(formatAssembly(dll));

// One-time decode + profile verification. Treat the module as immutable.
const module = loadAssembly(dll);
const vm = new VirtualMachine(module, {
  maxInstructions: 1_000_000,
  maxBytes: 8 * 1024 * 1024
});
const execution = vm.run();
if (execution.fault) throw execution.fault;
console.log(execution.output); // 42\n

// Reuse module; this creates independent frames/statics/heap/debug history.
const session = new DebugSession(module, { recordHistory: true });
session.start(true);
console.log(session.stackTrace()); // includes methodToken and ilOffset
```

`new VirtualMachine(dll)` and `new DebugSession(dll)` are convenience entry points that load the binary in their constructors. Reusing `loadAssembly(dll)` avoids repeated decoding when launching several instances. `ArrayBuffer` is also accepted. Each VM retains its own logical managed heap. Do not mutate the shared decoded module.

For a separately controlled pipeline, call `compile()` and then `emitAssemblyDetailed(result.image, options)`. `compileToIL()` combines the two and reports `CilError` as diagnostic `SF3001`. The low-level emitter and loader throw `CilError` for unsupported/bad inputs. `emitAssemblyDetailed` returns `{bytes, debug, metrics, framework}`; `emitAssembly` returns only bytes.

Studio source analysis deliberately does not call the IL backend. Keep that separation when embedding language services: PE emission belongs to builds, not every keystroke. The original source-debugging loader is restricted to the canonical emitted profile. For ordinary DLLs, use `AssemblyInspector` and `CilVirtualMachine` under the separate [managed IL contract](managed-il.md).

## Managed heap as a standalone component

```js
import { ManagedHeap } from '@sharpforge/runtime';

const heap = new ManagedHeap({ maxBytes: 1024 * 1024 });
let root = heap.object('Node', [null, 123]);
heap.rootProvider = () => [root];
heap.collect();              // root survives
root = null;
console.log(heap.collect()); // unreachable object reclaimed
```

A consumer owns the root contract. Any handle retained by the host and needed after collection must be yielded by `rootProvider` or temporarily pinned with `withRoots`. Generation checks detect stale handles; they do not automatically make arbitrary host references roots. Keep heap backing records private from untrusted code.

## Embedding the editor

```js
import { CodeEditor } from '@sharpforge/editor';

const editor = new CodeEditor(document.querySelector('#editor'), {
  onChange: text => console.log(text),
  onBreakpoint: line => console.log('toggle', line),
  request: async (method, params) => { /* dispatch to your language worker */ }
});
editor.setModel('Program.cs', 'Console.WriteLine(42);');
editor.setDiagnostics([]);
```

The source editor styles are the `.sf-*` rules in `apps/studio/studio.css`; embedding hosts must include them or supply equivalent layout styles. This version does not ship a separate theme-free editor stylesheet. The full Studio shell remains an app rather than an installable package.

## Projects and docking

Fifteen packages are versioned and packed for 0.4.0. The new [project-system package](../packages/project-system/README.md) exposes `ProjectSystem`, XML/path helpers and disk adapters. Pass explicitly selected file records to the loader, inspect diagnostics, then supply the chosen source closure to a Workspace. Do not treat loading as permission to execute MSBuild or restore NuGet packages.

The new [docking package](../packages/docking/README.md) exports a headless `DockLayout` and browser `DockHost`. Include `@sharpforge/docking/style.css`. Register stable tool/document IDs and cache your real panel elements; the host moves those elements and leaves application buffers in your ownership. Storage/persistence, worker supervision and transport remain host responsibilities. Studio's `docking-workspace.js` is a concrete integration example.

Use `compileToIL(files, { outputKind: 'library', name: 'Example' })` for libraries. Execute a supported method via `new CilVirtualMachine(bytes, { methodToken: 'Type::Method', arguments: [...] })`; no default program entry point is available for library targets.
