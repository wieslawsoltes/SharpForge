import { CredentialVault, IndexedDbCredentialStore } from '@sharpforge/git';

const databaseName = 'sharpforge-a25-native-vault-acceptance';
const accessToken = 'a25-native-access-marker-7a94c124';
const refreshToken = 'a25-native-refresh-marker-f1b37601';
const record = { provider: 'github', kind: 'pat', accessToken, refreshToken,
  allowedOrigins: ['https://github.com', 'https://api.github.com'], scopes: [] };

function assert(value, message) { if (!value) throw new Error(message); }

async function rejectCode(action, code) {
  try { await action(); } catch (error) {
    assert(error.code === code, 'Unexpected credential failure code');
    return;
  }
  throw new Error('Expected credential operation to reject');
}

async function rawVaultRecords() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Credential fixture database is missing')); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('vault', 'readonly');
      const store = transaction.objectStore('vault');
      let keys;
      let values;
      const keyRequest = store.getAllKeys();
      const valueRequest = store.getAll();
      keyRequest.onsuccess = () => { keys = keyRequest.result; };
      valueRequest.onsuccess = () => { values = valueRequest.result; };
      transaction.oncomplete = () => resolve(keys.map((key, index) => [key, values[index]]));
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Native vault scan failed'));
    });
  } finally { database.close(); }
}

function scanPlaintext(value) {
  if (typeof value === 'string') {
    assert(!value.includes(accessToken) && !value.includes(refreshToken), 'Native storage exposed plaintext credentials');
  } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    scanPlaintext(new TextDecoder().decode(bytes));
    scanPlaintext(new TextDecoder('utf-16le').decode(bytes));
  } else if (Array.isArray(value)) for (const item of value) scanPlaintext(item);
  else if (value && typeof value === 'object' && !(value instanceof CryptoKey)) {
    for (const [key, item] of Object.entries(value)) { scanPlaintext(key); scanPlaintext(item); }
  }
}

async function scanNativePersistence() {
  const entries = await rawVaultRecords();
  scanPlaintext(entries);
  for (const storage of [localStorage, sessionStorage]) {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      scanPlaintext(key);
      scanPlaintext(storage.getItem(key));
    }
  }
  const key = entries.find(([name]) => name === 'encryption-key')?.[1];
  if (key) {
    assert(key instanceof CryptoKey && key.algorithm.name === 'AES-GCM' && !key.extractable, 'Vault key is not a native non-extractable AES key');
    let rejected = false;
    try { await crypto.subtle.exportKey('raw', key); } catch { rejected = true; }
    assert(rejected, 'Native vault key was exportable');
  }
  return { records: entries.length, credentials: entries.filter(([name]) => String(name).startsWith('credential:')).length,
    keyStored: !!key, keyExtractable: key?.extractable ?? null, plaintextFound: false };
}

async function persistNativeCredentials(vault, store) {
  await store.clear();
  await vault.set('primary', record);
  await rejectCode(() => vault.enablePersistence(), 'Auth');
  assert((await rawVaultRecords()).length === 0, 'Session-only credentials entered IndexedDB');
  await vault.enablePersistence({ consent: true });
  await vault.set('secondary', { ...record, kind: 'oauth' });
  const first = await store.get('primary');
  await vault.set('primary', record);
  const second = await store.get('primary');
  assert(!first.iv.every((byte, index) => byte === second.iv[index]), 'Credential encryption reused its IV');
  const metadata = await scanNativePersistence();
  assert(metadata.credentials === 2 && metadata.keyStored, 'Encrypted credential records are incomplete');
  scanPlaintext(await vault.list());
  return { phase: 'write', backend: 'native-indexeddb', sessionRecords: 0, freshIv: true, ...metadata };
}

async function reloadNativeCredentials(vault, store) {
  await vault.enablePersistence({ consent: true });
  const restored = await vault.get('primary', { origin: 'https://api.github.com' });
  assert(restored?.accessToken === accessToken && restored.refreshToken === refreshToken, 'Encrypted credentials did not survive a real page reload');
  await rejectCode(() => vault.get('primary', { origin: 'https://untrusted.example' }), 'Auth');
  const encrypted = await store.get('primary');
  const tampered = new Uint8Array(encrypted.ciphertext.slice(0));
  tampered[0] ^= 1;
  await store.set('primary', { ...encrypted, ciphertext: tampered.buffer });
  await rejectCode(() => vault.get('primary'), 'Auth');
  await store.set('primary', encrypted);
  const persisted = await scanNativePersistence();
  await vault.disablePersistence();
  assert((await rawVaultRecords()).length === 0, 'Disabling persistence retained encrypted records or the key');
  assert((await vault.get('primary')).accessToken === accessToken, 'Disabling persistence lost the active session');
  await vault.clear();
  assert(await vault.get('primary') === null, 'Logout retained an active session credential');
  return { phase: 'read', backend: 'native-indexeddb', reloaded: true, originIsolation: true,
    tamperRejected: true, persisted, recordsAfterDisableAndLogout: (await rawVaultRecords()).length };
}

/** Two phases separated by an actual page reload; reads native IndexedDB values, not an injected store substitute. */
export async function runCredentialVault({ phase } = {}) {
  const store = new IndexedDbCredentialStore({ name: databaseName });
  const vault = new CredentialVault({ store });
  try {
    if (phase === 'write') return await persistNativeCredentials(vault, store);
    if (phase === 'read') return await reloadNativeCredentials(vault, store);
    throw new Error('Credential fixture phase must be write or read');
  } finally { await vault.dispose(); }
}
