import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {filesUnder, isMain} from './planning/test-manifests.js';
import {globPattern} from './planning/lib/paths.js';
import {runProcess, serialTestArgs} from './planning/run-tests.js';
import {npmCli} from './conformance/node-tools.js';
export const taskRoot = fileURLToPath(new URL('../', import.meta.url));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (object, keys, path) => {for (const key of Object.keys(object)) if (!keys.includes(key)) throw new Error(`${path}: unknown field ${key}`);};
export async function loadTasks(root = taskRoot) {
  const tasks = new Map(), aliases = new Map();
  for (const file of (await readdir(resolve(root, 'scripts/tasks'))).filter(f => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(await readFile(resolve(root, 'scripts/tasks', file), 'utf8'));
    onlyKeys(doc, ['schemaVersion', 'tasks', 'aliases'], file);
    if (doc.schemaVersion !== 1 || !doc.tasks && !doc.aliases) throw new Error(`${file}: invalid task contribution`);
    for (const [name, task] of Object.entries(doc.tasks ?? {})) {
      if (tasks.has(name)) throw new Error(`Duplicate task ${name}`);
      if (!object(task)) throw new Error(`Invalid task ${name}`);
      onlyKeys(task, ['description', 'steps'], name);
      if (!Array.isArray(task.steps) || !task.steps.length) throw new Error(`Task ${name} requires steps`);
      for (const step of task.steps) {
        if (!object(step)) throw new Error(`Invalid step in ${name}`);
        onlyKeys(step, ['task', 'command', 'args'], name);
        if (typeof step.task === 'string' && step.task.length && !step.command && !step.args) continue;
        if (typeof step.command !== 'string' || !step.command.length || step.command.includes('\0') || step.task || !Array.isArray(step.args) || step.args.some(a => typeof a !== 'string')) throw new Error(`Invalid step in ${name}`);
      }
      tasks.set(name, task);
    }
    for (const [alias, target] of Object.entries(doc.aliases ?? {})) {
      if (aliases.has(alias) || typeof target !== 'string') throw new Error(`Invalid/duplicate task alias ${alias}`);
      aliases.set(alias, target);
    }
  }
  for (const [name, target] of aliases) if (!tasks.has(target) || tasks.has(name) && name !== target) throw new Error(`Invalid task alias ${name} -> ${target}`);
  // Resolve every dependency up front so invalid contributions cannot partially execute.
  function visit(name, stack = []) {
    const canonical = aliases.get(name) ?? name, task = tasks.get(canonical);
    if (!task) throw new Error(`Unknown task ${name}`);
    if (stack.includes(canonical)) throw new Error(`Task cycle: ${[...stack, canonical].join(' -> ')}`);
    for (const step of task.steps) if (step.task) visit(step.task, [...stack, canonical]);
  }
  for (const name of tasks.keys()) visit(name);
  return {tasks, aliases};
}
export async function taskPlan(name, args = [], root = taskRoot) {
  const {tasks, aliases} = await loadTasks(root), plan = [], files = await filesUnder(root);
  async function expand(name, forwarded = []) {
    const canonical = aliases.get(name) ?? name, task = tasks.get(canonical);
    if (!task) throw new Error(`Unknown task ${name}. Use npm run task -- --list`);
    for (const [i, step] of task.steps.entries()) {
      const tail = i === task.steps.length - 1 ? forwarded : [];
      if (step.task) await expand(step.task, tail);
      else {
        const expanded = [];
        for (const arg of step.args) {
          if (/[?*]/.test(arg) && !arg.startsWith('-')) {
            const matched = files.filter(file => globPattern(arg).test(file));
            if (!matched.length) throw new Error(`Task ${canonical}: glob has no matches: ${arg}`);
            expanded.push(...matched);
          } else expanded.push(arg);
        }
        const command = step.command === 'node' || step.command === 'npm' ? process.execPath : step.command === 'python' ? process.env.PYTHON || 'python' : step.command;
        const prefix = step.command === 'npm' ? [npmCli()] : [];
        if (prefix.some(path => !path)) throw new Error('Cannot locate npm CLI');
        const argv = [...prefix, ...expanded, ...tail];
        plan.push({command, args: step.command === 'node' ? serialTestArgs(argv) : argv});
      }
    }
  }
  await expand(name, args); return plan;
}
export async function main(args) {
  if (!args.length || args[0] === '--list') {
    const {tasks, aliases} = await loadTasks();
    console.log(JSON.stringify({tasks: [...tasks.keys()].sort(), aliases: Object.fromEntries(aliases)}, null, 2)); return 0;
  }
  const name = args.shift(), dryRun = args[0] === '--dry-run'; if (dryRun) args.shift();
  const plan = await taskPlan(name, args);
  if (dryRun) {console.log(JSON.stringify(plan, null, 2)); return 0;}
  for (const step of plan) {const status = await runProcess(step.command, step.args, {cwd: taskRoot}); if (status) return status;}
  return 0;
}
if (isMain(import.meta.url)) {
  try {process.exitCode = await main(process.argv.slice(2));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
