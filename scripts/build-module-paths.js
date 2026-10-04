import {readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, resolve, relative, sep} from 'node:path';

/** Preserve the production module rewrite for copied JavaScript, including root-only legacy paths. */
export async function rewriteModulePaths(directory, dist = directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await rewriteModulePaths(path, dist);
    else if (entry.name.endsWith('.js')) {
      let text = await readFile(path, 'utf8');
      if (dirname(path) === dist) text = text.replaceAll("'../../packages/", "'./packages/");
      text = text.replace(/(['"])@sharpforge\/([\w-]+)\1/g, (_, quote, name) => {
        let target = relative(dirname(path), resolve(dist, 'packages', name, 'src/index.js')).split(sep).join('/');
        if (!target.startsWith('.')) target = './' + target;
        return quote + target + quote;
      });
      await writeFile(path, text);
    }
  }
}
