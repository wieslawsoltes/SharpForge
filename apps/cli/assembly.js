/**
 * `compile --format dotnet`: a real .NET assembly from the direct CIL pipeline of the compiler (`compileToAssembly`),
 * bound against .NET reference assemblies, plus the `<name>.runtimeconfig.json` that lets `dotnet <name>.dll` run it.
 *
 * The references are, in this order: the files given with `--reference` (repeatable); the directory given with
 * `--reference-pack` (a directory of reference assemblies, or a .NET installation to take the newest pack from); else
 * the reference pack of the installed .NET SDK (`DOTNET_ROOT`, `~/.dotnet`, the platform's default locations).
 */
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileToAssembly, createReferenceSet } from '../../packages/compiler/src/index.js';
import { locateReferencePack, readReferenceFiles } from '../../packages/compiler/src/node.js';
import { createRuntimeConfig } from '../../packages/cil/src/index.js';

/** The runtime an assembly asks for when the references do not say which framework they are. */
const DEFAULT_RUNTIME = '8.0';
const isAssembly = name => name.toLowerCase().endsWith('.dll');

/**
 * Takes `--reference PATH` (repeatable) and `--reference-pack DIRECTORY` out of the argument list.
 * @param {(name: string, fallback?: any) => any} option the CLI's option reader (it removes what it reads)
 * @param {string[]} args the remaining arguments  @param {string} format the `--format` in effect
 * @returns {{references: string[], referencePack: string|undefined}}
 */
export function readAssemblyOptions(option, args, format) {
  const references = [];
  while (args.includes('--reference')) references.push(option('--reference'));
  const referencePack = option('--reference-pack', undefined);
  if (format !== 'dotnet' && (references.length || referencePack)) throw new Error('--reference and --reference-pack need --format dotnet');
  return { references, referencePack };
}

/** `net10.0` in a path names the framework of the assemblies under it. */
function frameworkOfPath(path) {
  const found = /(?:^|[\\/])net(\d+\.\d+)(?:[\\/]|$)/.exec(path);
  return found ? found[1] : null;
}

/** The reference assemblies of a directory: the directory itself when it holds assemblies, else a .NET installation. */
function referencePackFiles(directory) {
  if (!existsSync(directory)) throw new Error(`Reference pack directory not found: ${directory}`);
  const files = readdirSync(directory).filter(isAssembly).sort();
  if (files.length) {
    return { files: files.map(name => join(directory, name)), framework: frameworkOfPath(directory), description: directory };
  }
  const pack = locateReferencePack({ dotnetRoot: directory });
  if (!pack) throw new Error(`No reference assemblies and no .NET reference pack in ${directory}`);
  return { files: pack.files, framework: pack.targetFramework.slice(3), description: `reference pack ${pack.version}` };
}

/**
 * Chooses and reads the reference assemblies.
 * @returns {{references: object[], framework: string, description: string}} `framework` is `major.minor`
 */
export function loadReferences({ references, referencePack }) {
  let chosen;
  if (references.length) {
    const framework = references.map(frameworkOfPath).find(Boolean) ?? null;
    chosen = { files: references, framework, description: `${references.length} reference${references.length === 1 ? '' : 's'}` };
  } else if (referencePack) chosen = referencePackFiles(referencePack);
  else {
    const pack = locateReferencePack();
    if (!pack) {
      throw new Error('No .NET reference pack was found. Install the .NET SDK, set DOTNET_ROOT, or pass --reference-pack DIRECTORY or --reference PATH.');
    }
    chosen = { files: pack.files, framework: pack.targetFramework.slice(3), description: `reference pack ${pack.version}` };
  }
  for (const file of chosen.files) if (!existsSync(file)) throw new Error(`Reference not found: ${file}`);
  return {
    references: createReferenceSet(readReferenceFiles(chosen.files)),
    framework: chosen.framework ?? DEFAULT_RUNTIME,
    description: chosen.description,
  };
}

/**
 * Compiles to a .NET assembly.
 * @param input what the CLI compiles (loose sources or the files of a project)  @param {object} compileOptions the
 *   CLI's compilation options (`name`, `outputKind`, language options)  @param assemblyOptions see `readAssemblyOptions`
 * @returns the result of `compileToAssembly` with `framework` and `referenceDescription` added
 */
export function compileDotnetAssembly(input, compileOptions, assemblyOptions) {
  const loaded = loadReferences(assemblyOptions),
    result = compileToAssembly(input, { ...compileOptions, references: loaded.references });
  return { ...result, framework: loaded.framework, referenceDescription: loaded.description };
}

/**
 * Writes the assembly and, for an executable, its runtime configuration.
 * @param result a successful result of `compileDotnetAssembly`  @param {string} output the assembly path
 * @returns {Promise<string>} what was written, for the console
 */
export async function writeDotnetAssembly(result, output, outputKind) {
  await writeFile(output, result.assembly);
  const summary = `Wrote ${output}: ${result.assembly.length} bytes .NET assembly (${result.referenceDescription})`;
  if (outputKind === 'library') return summary;
  const configPath = output.replace(/\.(dll|exe)$/i, '') + '.runtimeconfig.json',
    config = createRuntimeConfig({ version: result.framework + '.0' });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  return `${summary}\nWrote ${configPath}: run with \`dotnet ${output}\``;
}
