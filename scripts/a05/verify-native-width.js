import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyNativeWidthReport} from './native-width-proof.js';

const [directory, requestedBits, sdk] = process.argv.slice(2);
if (!directory || !requestedBits || !sdk) throw new Error('Usage: verify-native-width.js evidence-directory bits exact-sdk');
const output = resolve(directory);
const result = {format: 'SharpForge.NativeWidthQualification/1', passed: false, status: 'failed',
  expectedNativeIntBits: Number(requestedBits), expectedSdk: sdk, timestamp: new Date().toISOString()};
try {
  const bytes = await readFile(join(output, 'native-width', 'qualification.json'));
  const report = JSON.parse(bytes.toString('utf8'));
  Object.assign(result, verifyNativeWidthReport(report, {bits: Number(requestedBits), sdk}),
    {revision: report.revision, qualificationSha256: createHash('sha256').update(bytes).digest('hex'), passed: true, status: 'passed'});
} catch (error) {
  result.error = {name: error.name, message: error.message};
  process.exitCode = 1;
} finally {
  await mkdir(output, {recursive: true});
  await writeFile(join(output, 'native-width-result.json'), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result));
