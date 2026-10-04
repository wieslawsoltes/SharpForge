import { mkdir, rm, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { runBuildGenerators } from './build-generators.js';

async function rewriteImports(directory, destination) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await rewriteImports(path, destination);
    else if (entry.name.endsWith('.js')) {
      let text = await readFile(path, 'utf8');
      if (dirname(path) === destination) text = text.replaceAll("'../../packages/", "'./packages/");
      text = text.replace(/(['"])@sharpforge\/([\w-]+)\1/g, (_match, quote, name) => {
        let target = relative(dirname(path), resolve(destination, 'packages', name, 'src/index.js')).split(sep).join('/');
        if (!target.startsWith('.')) target = './' + target;
        return quote + target + quote;
      });
      await writeFile(path, text);
    }
  }
}

/** Copy contributed assets, generate declared files, then rewrite package imports for the static browser tree. */
export async function prepareBuildAssets(contributions, { root, destination }) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const asset of contributions.assets) {
    const target = resolve(destination, asset.target);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(root, asset.source), target, { recursive: true });
  }
  await runBuildGenerators(contributions.generators ?? [], { root, destination });
  await rewriteImports(destination, destination);
}
