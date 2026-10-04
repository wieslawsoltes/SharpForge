import { target as peLoader } from './pe-loader.js';
import { target as bytecodeImage } from './bytecode-image.js';
import { target as portablePdb } from './portable-pdb.js';
import { target as zipArchive } from './zip-archive.js';
import { target as protocol } from './protocol.js';
import { target as ilDocument } from './il-document.js';
import { target as msbuildXml } from './msbuild-xml.js';
import { target as network } from './network.js';

/** Only the disposable child loads parsers and the actual source VM. */
export const targets = Object.freeze({
  'pe-loader': peLoader,
  'bytecode-image': bytecodeImage,
  'portable-pdb': portablePdb,
  'zip-archive': zipArchive,
  protocol,
  'il-document': ilDocument,
  'msbuild-xml': msbuildXml,
  network,
});
