import { z } from 'zod';
import { define, empty, obj, request } from './shared.js';
import type { CapabilityContext } from './types.js';

export function solanaCapabilities(c: CapabilityContext) {
  const address = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
  const signature = z.string().min(64).max(88).regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
  const rpc = async (method: string, params: unknown[] = []) => {
    const result = (await request(c, c.env.SOLANA_RPC_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, true)).data;
    if (result.error) throw new Error(`Solana RPC error ${result.error.code}: ${String(result.error.message).slice(0, 200)}`);
    return result.result;
  };
  const add = (name: string, description: string, schema: z.ZodType, fn: (i: any) => any) => define(c, name, description, 'solana', 'read', schema, ['SOLANA_RPC_URL'], fn);
  return [
    add('solana_balance', 'Read a public wallet balance in lamports and SOL.', obj({ address }), async i => { const r = await rpc('getBalance', [i.address, { commitment: 'finalized' }]); return { ...r, lamports: r.value, sol: r.value / 1_000_000_000 }; }),
    add('solana_account_info', 'Read public account state using parsed encoding.', obj({ address }), i => rpc('getAccountInfo', [i.address, { encoding: 'jsonParsed', commitment: 'finalized' }])),
    add('solana_signatures', 'Read recent finalized transaction signatures for an address.', obj({ address, limit: z.number().int().min(1).max(100).default(20) }), i => rpc('getSignaturesForAddress', [i.address, { limit: i.limit, commitment: 'finalized' }])),
    add('solana_transaction', 'Read a finalized transaction; does not sign or submit.', obj({ signature }), i => rpc('getTransaction', [i.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }])),
    add('solana_signature_status', 'Read confirmation and error status for transaction signatures.', obj({ signatures: z.array(signature).min(1).max(100) }), i => rpc('getSignatureStatuses', [i.signatures, { searchTransactionHistory: true }])),
    add('solana_token_accounts', 'Read SPL token accounts owned by a public wallet.', obj({ address, programId: address.default('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }), i => rpc('getTokenAccountsByOwner', [i.address, { programId: i.programId }, { encoding: 'jsonParsed', commitment: 'finalized' }])),
    add('solana_token_balance', 'Read the public token balance of an SPL token account.', obj({ address }), i => rpc('getTokenAccountBalance', [i.address, { commitment: 'finalized' }])),
    add('solana_token_supply', 'Read total token supply for a public mint.', obj({ mint: address }), i => rpc('getTokenSupply', [i.mint, { commitment: 'finalized' }])),
    add('solana_slot', 'Read the current finalized slot.', empty, () => rpc('getSlot', [{ commitment: 'finalized' }])),
    add('solana_block', 'Read block metadata and signatures for a finalized slot.', obj({ slot: z.number().int().nonnegative() }), i => rpc('getBlock', [i.slot, { transactionDetails: 'signatures', rewards: false, commitment: 'finalized', maxSupportedTransactionVersion: 0 }])),
    add('solana_latest_blockhash', 'Read a current finalized blockhash and expiry height.', empty, () => rpc('getLatestBlockhash', [{ commitment: 'finalized' }])),
    add('solana_fee_estimate', 'Read the estimated network fee for a supplied base64 transaction message; never sign or submit.', obj({ messageBase64: z.string().min(4).max(2000).regex(/^[A-Za-z0-9+/=]+$/) }), i => rpc('getFeeForMessage', [i.messageBase64, { commitment: 'finalized' }])),
    add('solana_rent_estimate', 'Read minimum lamports required for a rent-exempt account size.', obj({ bytes: z.number().int().min(0).max(1_000_000) }), i => rpc('getMinimumBalanceForRentExemption', [i.bytes])),
    add('solana_health', 'Read RPC node health.', empty, () => rpc('getHealth')),
    add('solana_version', 'Read RPC software and feature-set versions.', empty, () => rpc('getVersion')),
  ];
}
