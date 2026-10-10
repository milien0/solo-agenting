import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile, symlink, unlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { provisionWallet, base58Encode } from '../src/wallet.js';
import { getConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function decodeAddress(value: string): Uint8Array {
  let number = 0n;
  for (const ch of value) { const digit = alphabet.indexOf(ch); assert.ok(digit >= 0, 'public address uses base58 characters'); number = number * 58n + BigInt(digit); }
  const bytes: number[] = [];
  while (number) { bytes.unshift(Number(number % 256n)); number /= 256n; }
  for (const ch of value) { if (ch !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
async function fixture(t: TestContext) {
  // macOS exposes /var/folders through /private/var/folders. Canonicalize the
  // OS temporary parent so safe fixtures do not themselves contain symlinks.
  const temporaryParent = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryParent, 'solo-wallet-test-'));
  const vault = join(root, 'private-vault');
  t.after(async () => {
    assert.equal(dirname(resolve(root)), temporaryParent);
    assert.ok(basename(root).startsWith('solo-wallet-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, vault, walletPath: join(vault, 'solana-wallet.json'), keyPath: join(vault, 'wallet-encryption.key') };
}
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

test('wallet provisioning persists a valid public identity and returns only public metadata', async t => {
  const { vault, walletPath, keyPath } = await fixture(t);
  const first = await provisionWallet(vault);
  assert.equal(first.created, true);
  assert.equal(first.network, 'solana');
  assert.equal(first.signingAvailable, false);
  assert.equal(decodeAddress(first.publicAddress).length, 32);
  const allowed = new Set(['publicAddress', 'network', 'created', 'custody', 'createdAt', 'signingAvailable']);
  assert.ok(Object.keys(first).every(key => allowed.has(key)), 'wallet provisioning never exposes private payloads or encryption keys');
  const walletBefore = sha(await readFile(walletPath));
  const keyBefore = sha(await readFile(keyPath));
  const second = await provisionWallet(vault);
  assert.equal(second.created, false);
  assert.equal(second.publicAddress, first.publicAddress);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(sha(await readFile(walletPath)), walletBefore);
  assert.equal(sha(await readFile(keyPath)), keyBefore);
});

test('parallel wallet provisioning shares one identity and leaves a readable encrypted vault', async t => {
  const { vault, walletPath } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => provisionWallet(vault)));
  assert.equal(new Set(results.map(result => result.publicAddress)).size, 1);
  const record = JSON.parse(await readFile(walletPath, 'utf8'));
  assert.equal(record.publicAddress, results[0]!.publicAddress);
  assert.equal((await provisionWallet(vault)).created, false);
});

test('wallet JSON contains authenticated ciphertext and never stores the direct private payload or seed', async t => {
  const { vault, walletPath, keyPath } = await fixture(t);
  const wallet = await provisionWallet(vault);
  const raw = await readFile(walletPath, 'utf8');
  const record = JSON.parse(raw);
  assert.equal(record.encryption.algorithm, 'aes-256-gcm');
  assert.equal(Buffer.from(record.encryption.iv, 'base64').length, 12);
  assert.equal(Buffer.from(record.encryption.tag, 'base64').length, 16);
  const key = await readFile(keyPath);
  assert.equal(key.length, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.encryption.iv, 'base64'));
  decipher.setAAD(Buffer.from(`solana:${record.publicAddress}`));
  decipher.setAuthTag(Buffer.from(record.encryption.tag, 'base64'));
  const privateDer = Buffer.concat([decipher.update(Buffer.from(record.encryption.ciphertext, 'base64')), decipher.final()]);
  try {
    const privateObject = createPrivateKey({ key: privateDer, type: 'pkcs8', format: 'der' });
    const privateJwk = privateObject.export({ format: 'jwk' });
    const derivedJwk = createPublicKey(privateObject).export({ format: 'jwk' });
    assert.equal(base58Encode(Buffer.from(derivedJwk.x!, 'base64url')), wallet.publicAddress);
    const seed = Buffer.from(privateJwk.d!, 'base64url');
    assert.equal(seed.length, 32);
    for (const privateValue of [privateDer.toString('base64'), privateDer.toString('hex'), seed.toString('base64'), seed.toString('hex'), seed.toString('base64url'), key.toString('base64')]) assert.equal(raw.includes(privateValue), false, 'encrypted record contains no direct private key/seed/encryption key');
    assert.equal(Object.hasOwn(record, 'privateKey'), false);
    assert.equal(Object.hasOwn(record, 'seed'), false);
    seed.fill(0);
  } finally { privateDer.fill(0); key.fill(0); }
  if (process.platform !== 'win32') {
    assert.equal((await stat(walletPath)).mode & 0o777, 0o600);
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    assert.equal((await stat(vault)).mode & 0o777, 0o700);
  }
});

test('tampered public routing metadata fails authentication without generating a replacement wallet', async t => {
  const { vault, walletPath, keyPath } = await fixture(t);
  const original = await provisionWallet(vault);
  const raw = await readFile(walletPath, 'utf8');
  const record = JSON.parse(raw);
  record.publicAddress = base58Encode(randomBytes(32));
  const changed = JSON.stringify(record);
  const keyHash = sha(await readFile(keyPath));
  await writeFile(walletPath, changed);
  await assert.rejects(provisionWallet(vault), /auth|match|state|wallet/i);
  assert.equal(await readFile(walletPath, 'utf8'), changed, 'corrupt identity is an attention item, never replaced silently');
  assert.equal(sha(await readFile(keyPath)), keyHash);
  await writeFile(walletPath, raw);
  assert.equal((await provisionWallet(vault)).publicAddress, original.publicAddress);
});

test('missing encryption key refuses recovery rather than replacing an existing wallet', async t => {
  const { vault, walletPath, keyPath } = await fixture(t);
  await provisionWallet(vault);
  const before = await readFile(walletPath, 'utf8');
  await unlink(keyPath);
  await assert.rejects(provisionWallet(vault), /missing|incomplete|restore|partial/i);
  assert.equal(await readFile(walletPath, 'utf8'), before);
  await assert.rejects(stat(keyPath), { code: 'ENOENT' });
});

test('missing wallet ciphertext refuses recovery instead of issuing a new public identity', async t => {
  const { vault, walletPath, keyPath } = await fixture(t);
  await provisionWallet(vault);
  const before = sha(await readFile(keyPath));
  await unlink(walletPath);
  await assert.rejects(provisionWallet(vault), /missing|incomplete|restore|partial|exists/i);
  assert.equal(sha(await readFile(keyPath)), before);
  await assert.rejects(stat(walletPath), { code: 'ENOENT' });
});

test('vault provisioning rejects directory links and regular-file paths without writing through links', async t => {
  const { root, vault } = await fixture(t);
  const target = join(root, 'outside');
  await mkdir(target);
  await symlink(target, vault, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(provisionWallet(vault), /symlink/);
  await assert.rejects(stat(join(target, 'solana-wallet.json')), { code: 'ENOENT' });
  const filePath = join(root, 'ordinary-file');
  await writeFile(filePath, 'keep');
  await assert.rejects(provisionWallet(filePath));
  assert.equal(await readFile(filePath, 'utf8'), 'keep');
});

test('wallet and encryption-key link substitution cannot read or rewrite another location', async t => {
  for (const name of ['solana-wallet.json', 'wallet-encryption.key']) {
    const { root, vault } = await fixture(t);
    await provisionWallet(vault);
    const targetDir = join(root, 'untouched');
    await mkdir(targetDir);
    const targetFile = join(targetDir, 'payload');
    await writeFile(targetFile, 'keep', { mode: 0o600 });
    const link = join(vault, name);
    await unlink(link);
    await symlink(process.platform === 'win32' ? targetDir : targetFile, link, process.platform === 'win32' ? 'junction' : 'file');
    await assert.rejects(provisionWallet(vault), /symlink|regular/);
    assert.equal(await readFile(targetFile, 'utf8'), 'keep');
  }
});

test('Unix vault files with group or world access are rejected', { skip: process.platform === 'win32' }, async t => {
  const { vault, keyPath } = await fixture(t);
  await provisionWallet(vault);
  await chmod(keyPath, 0o644);
  await assert.rejects(provisionWallet(vault), /owner|mode 600/);
});

test('an owner-configured public address is reused without creating any private vault', async t => {
  const { root, vault } = await fixture(t);
  const project = join(root, 'project');
  const store = new Store(':memory:');
  try {
    const runtime = new Runtime({ ...getConfig(project), root: project, workspace: join(project, 'workspace'), dataDir: join(project, 'data'), vaultDir: vault, autoEve: false }, { SOLANA_WALLET_ADDRESS: base58Encode(new Uint8Array(32)) }, store);
    const result: any = await runtime.execute('wallet_provision', {});
    assert.equal(result.publicAddress, '1'.repeat(32));
    assert.equal(result.created, false);
    assert.equal(result.signingAvailable, false);
    await assert.rejects(stat(vault), { code: 'ENOENT' });
  } finally { store.close(); }
});

test('runtime refuses configured vaults inside the project or artifact workspace', async t => {
  for (const location of ['repository', 'workspace']) {
    const { root } = await fixture(t);
    const project = join(root, 'project');
    const workspace = join(root, 'artifacts');
    const vault = join(location === 'repository' ? project : workspace, 'private-vault');
    const store = new Store(':memory:');
    try {
      const runtime = new Runtime({ ...getConfig(project), root: project, workspace, dataDir: join(root, 'data'), vaultDir: vault, autoEve: false }, {}, store);
      await assert.rejects(runtime.execute('wallet_provision', {}), /outside|project|repository|workspace|artifact/i);
      await assert.rejects(stat(vault), { code: 'ENOENT' });
    } finally { store.close(); }
  }
});

test('workspace directory aliases cannot hide vault files inside the actual artifact root', async t => {
  const { root } = await fixture(t);
  const project = join(root, 'project');
  const actualArtifacts = join(root, 'actual-artifacts');
  const workspaceAlias = join(root, 'workspace-alias');
  await mkdir(actualArtifacts);
  await symlink(actualArtifacts, workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const vault = join(actualArtifacts, 'private-vault');
  const store = new Store(':memory:');
  try {
    const runtime = new Runtime({ ...getConfig(project), root: project, workspace: workspaceAlias, dataDir: join(root, 'data'), vaultDir: vault, autoEve: false }, {}, store);
    await assert.rejects(runtime.execute('wallet_provision', {}), /outside|project|repository|workspace|artifact|symlink/i);
    await assert.rejects(stat(vault), { code: 'ENOENT' });
  } finally { store.close(); }
});
