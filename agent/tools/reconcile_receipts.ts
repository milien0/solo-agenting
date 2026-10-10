import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { reconcileReceipts } from '../lib/capabilities.js';
export default defineTool({description:'Reconcile live settled Stripe receipts into the verified challenge ledger. Requires configured Stripe credentials and a started challenge. Test-mode payments never count.',inputSchema:z.object({}),execute:()=>reconcileReceipts()});
