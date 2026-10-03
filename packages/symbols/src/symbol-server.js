import { readPE, equalBytes } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { portablePdbKey, peSymbolKey, keyUrl } from './symbol-server-key.js';
import { readPortablePdb } from './pdb-reader.js';
import { loadSymbols } from './symbol-loader.js';
import { readDebugDirectory } from './debug-directory.js';
import { createPermissionedFetcher } from './permission-fetch.js';
import { SourceStatus, sourceFailure, sourceResult, httpsUrl } from './source-status.js';

function invalidIdentity(error) {
  return sourceFailure(SourceStatus.invalidIdentity, String(error?.message ?? error));
}

function copyAssembly(input, maxBytes) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes) fail('Invalid or oversized lookup assembly');
  return new Uint8Array(bytes);
}

/** Create an explicit SSQP client with the source transport's origin grants, byte/time limits and disposal. */
export function createSymbolServer(options = {}) {
  if (!options || typeof options !== 'object') fail('Invalid symbol server options');
  const server = httpsUrl(options.serverUrl);
  if (server.search || server.hash) fail('Symbol server URL cannot contain query or fragment components');
  if (!server.pathname.endsWith('/')) server.pathname += '/';
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const transport = createPermissionedFetcher({ ...options, maxBytes });

  async function lookupOwnedPortablePdb(key, id, { signal, assembly: boundAssembly }) {
    try {
      return await transport.read(keyUrl(server, key), {
        signal,
        purpose: 'symbol-server',
        validate(bytes) {
          try {
            const symbols = boundAssembly
              ? loadSymbols(boundAssembly, bytes, { maxBytes })
              : readPortablePdb(bytes, { maxBytes });
            if (!equalBytes(symbols.id, id)) fail('Symbol server returned a different Portable PDB identity');
            return {
              key,
              kind: 'portable-pdb',
              symbols,
              identityVerified: true,
              checksumVerified:
                !!boundAssembly && readDebugDirectory(boundAssembly, { maxBytes }).some((entry) => entry.kind === 19),
            };
          } catch (error) {
            throw invalidIdentity(error);
          }
        },
      });
    } catch (error) {
      return sourceResult(SourceStatus.invalidIdentity, { reason: String(error?.message ?? error) });
    }
  }

  async function lookupPortablePdb(name, inputId, { signal, assembly } = {}) {
    try {
      const key = portablePdbKey(name, inputId);
      const id = new Uint8Array(inputId);
      const owned = assembly == null ? null : copyAssembly(assembly, maxBytes);
      return await lookupOwnedPortablePdb(key, id, { signal, assembly: owned });
    } catch (error) {
      return sourceResult(SourceStatus.invalidIdentity, { reason: String(error?.message ?? error) });
    }
  }

  return {
    lookupPortablePdb,
    async lookupForAssembly(input, { signal } = {}) {
      try {
        const assembly = copyAssembly(input, maxBytes);
        const entry = readDebugDirectory(assembly, { maxBytes }).find(
          (item) => item.kind === 2 && item.minor === 0x504d && item.age === 1,
        );
        if (!entry) fail('Assembly has no Portable PDB lookup identity');
        const key = portablePdbKey(entry.path, entry.id);
        return await lookupOwnedPortablePdb(key, entry.id, { signal, assembly });
      } catch (error) {
        return sourceResult(SourceStatus.invalidIdentity, { reason: String(error?.message ?? error) });
      }
    },
    async lookupPE(name, identity, { signal } = {}) {
      try {
        const expected = { timestamp: identity?.timestamp, sizeOfImage: identity?.sizeOfImage };
        const key = peSymbolKey(name, expected);
        return await transport.read(keyUrl(server, key), {
          signal,
          purpose: 'symbol-server',
          validate(bytes) {
            try {
              const pe = readPE(bytes, { inspection: true, maxBytes });
              if (pe.timestamp !== expected.timestamp || pe.sizeOfImage !== expected.sizeOfImage) {
                fail('Symbol server returned a different PE identity');
              }
              return { key, kind: 'pe', pe, identityVerified: true, checksumVerified: false };
            } catch (error) {
              throw invalidIdentity(error);
            }
          },
        });
      } catch (error) {
        return sourceResult(SourceStatus.invalidIdentity, { reason: String(error?.message ?? error) });
      }
    },
    dispose() {
      transport.dispose();
    },
    get cleanupErrors() {
      return transport.cleanupErrors;
    },
  };
}
