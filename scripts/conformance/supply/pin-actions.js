import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isMain, readJSON, repository, walkFiles} from './files.js';

/** Update only reviewed major references; never fetch or silently upgrade dependencies. */
export function applyPins(text, pins) {
  return text.replace(/(\buses:\s*)([\w./-]+)@([\w.-]+)([^\S\r\n]*(?:#[^\r\n]*)?)/g, (whole, prefix, action, ref) => {
    const repo = action.split('/').slice(0, 2).join('/');
    const pin = pins.actions[repo];
    if (!pin || !/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error('ACTION_PIN: unknown action ' + repo);
    if (ref !== pin.ref && ref !== pin.commit) throw new Error('ACTION_PIN: review changed reference ' + repo + '@' + ref);
    return prefix + action + '@' + pin.commit + ' # ' + pin.ref;
  });
}

export async function pinActions({root = repository, write = false} = {}) {
  const pins = await readJSON(resolve(root, 'planning/qualification/supply/action-pins.json'), {root});
  const files = await walkFiles(resolve(root, '.github'), {boundary: root});
  let changed = 0;
  for (const name of files.filter(name => /\.ya?ml$/.test(name))) {
    const path = resolve(root, '.github', name);
    const original = await readFile(path, 'utf8');
    const pinned = applyPins(original, pins);
    if (pinned !== original) {
      changed++;
      if (write) await writeFile(path, pinned);
    }
  }
  if (changed && !write) throw new Error('ACTION_PIN: ' + changed + ' files require reviewed SHA pins');
  return {changed, written: write};
}

if (isMain(import.meta.url)) console.log(JSON.stringify(await pinActions({write: process.argv.includes('--write')})));
