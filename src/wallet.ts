import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, realpath, chmod } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep, dirname, basename } from 'node:path';

async function canonicalLocation(path:string):Promise<string> {
  const absolute=resolve(path);
  try {return await realpath(absolute);}catch(error) {
    if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;
    const parent=dirname(absolute);if(parent===absolute)throw error;
    return join(await canonicalLocation(parent),basename(absolute));
  }
}
export async function assertVaultOutside(vaultDirectory:string, excludedDirectories:string[]) {
  const vault=await canonicalLocation(vaultDirectory);
  for(const parent of excludedDirectories) {
    const diff=relative(await canonicalLocation(parent),vault);
    if(diff===''||(!isAbsolute(diff)&&diff!=='..'&&!diff.startsWith(`..${sep}`)))throw new Error('Wallet vault must remain outside the project and artifact workspace');
  }
}

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes:Uint8Array) {
  let number=BigInt(`0x${Buffer.from(bytes).toString('hex')||'0'}`);let result='';
  while(number>0n){result=alphabet[Number(number%58n)]+result;number/=58n;}
  for(const byte of bytes){if(byte!==0)break;result='1'+result;}
  return result;
}
type VaultRecord={version:1;network:'solana';publicAddress:string;createdAt:string;encryption:{algorithm:'aes-256-gcm';iv:string;tag:string;ciphertext:string}};
const provisioning=new Map<string,Promise<Awaited<ReturnType<typeof createOrReadWallet>>>>();
async function secureFile(path:string) {
  const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Wallet vault files must be regular files without symlinks');
  if(process.platform!=='win32'&&(stat.mode&0o077)!==0)throw new Error('Wallet vault files must be readable only by the owner (mode 600)');
}
export function provisionWallet(vaultDirectory:string) {
  const directory=resolve(vaultDirectory);const key=process.platform==='win32'?directory.toLowerCase():directory;
  const existing=provisioning.get(key);if(existing)return existing;
  const pending=createOrReadWallet(directory).finally(()=>provisioning.delete(key));provisioning.set(key,pending);return pending;
}
async function createOrReadWallet(vaultDirectory:string) {
  const directory=resolve(vaultDirectory);
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat=await lstat(directory);
  if(stat.isSymbolicLink()||!stat.isDirectory()||(await realpath(directory))!==directory)throw new Error('Wallet vault directory cannot contain symlinks');
  if(process.platform!=='win32')await chmod(directory,0o700);
  const walletPath=join(directory,'solana-wallet.json');const keyPath=join(directory,'wallet-encryption.key');
  try {
    await secureFile(walletPath);await secureFile(keyPath);
    const record=JSON.parse(await readFile(walletPath,'utf8')) as VaultRecord;
    if(record.version!==1||record.network!=='solana'||!record.publicAddress||record.encryption?.algorithm!=='aes-256-gcm')throw new Error('Invalid wallet vault format');
    const key=await readFile(keyPath);if(key.length!==32)throw new Error('Invalid wallet encryption key');
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.encryption.iv,'base64'));decipher.setAAD(Buffer.from(`solana:${record.publicAddress}`));decipher.setAuthTag(Buffer.from(record.encryption.tag,'base64'));
    const privateDer=Buffer.concat([decipher.update(Buffer.from(record.encryption.ciphertext,'base64')),decipher.final()]);
    const derived=createPublicKey(createPrivateKey({key:privateDer,format:'der',type:'pkcs8'})).export({format:'jwk'});
    if(base58Encode(Buffer.from(derived.x!,'base64url'))!==record.publicAddress)throw new Error('Wallet public address does not match its private key');
    privateDer.fill(0);key.fill(0);
    return {publicAddress:record.publicAddress,network:'solana',created:false,custody:'encrypted local vault',createdAt:record.createdAt,signingAvailable:false};
  } catch(error) {
    if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;
    // An incomplete vault is an attention item, never permission to replace a key.
    try {await lstat(walletPath);throw new Error('Existing wallet is missing its encryption key; restore the vault backup');}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
    try {await lstat(keyPath);throw new Error('Incomplete wallet vault: encryption key exists without its wallet record; restore the complete vault backup');}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='ENOENT'))throw e;}
  }
  const keyPair=generateKeyPairSync('ed25519');
  const publicJwk=keyPair.publicKey.export({format:'jwk'});
  const publicBytes=Buffer.from(publicJwk.x!,'base64url');
  if(publicBytes.length!==32)throw new Error('Unexpected Ed25519 public key length');
  const publicAddress=base58Encode(publicBytes);
  const privateDer=keyPair.privateKey.export({format:'der',type:'pkcs8'});
  let key:Buffer;
  try {await secureFile(keyPath);key=await readFile(keyPath);if(key.length!==32)throw new Error('Invalid wallet encryption key');}
  catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;key=randomBytes(32);await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(`solana:${publicAddress}`));
  const ciphertext=Buffer.concat([cipher.update(privateDer),cipher.final()]);
  const record:VaultRecord={version:1,network:'solana',publicAddress,createdAt:new Date().toISOString(),encryption:{algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}};
  privateDer.fill(0);key.fill(0);
  await writeFile(walletPath,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {publicAddress,network:'solana',created:true,custody:'encrypted local vault',createdAt:record.createdAt,signingAvailable:false};
}
