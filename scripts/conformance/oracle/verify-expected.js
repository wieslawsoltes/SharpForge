import { verifyStore } from './store.js';

try {
  console.log(JSON.stringify(await verifyStore(process.argv[2]), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
