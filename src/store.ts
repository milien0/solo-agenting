import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Task = {
  id: string; title: string; instructions: string; role: string; status: string;
  priority: number; attempts: number; createdAt: string; updatedAt: string;
  sessionId?: string; streamIndex?: number; result?: string; error?: string; leaseUntil?: string;
  nextAttemptAt?: string;
};
export type LedgerInput = {
  type: string; amountUsd: number; description: string; externalRef: string;
  occurredAt?: string; relatedRef?: string; receiptStatus?: 'valid'|'disputed';
};
export type LedgerEntry = LedgerInput & {
  id: string; verified: boolean; source: string; createdAt: string; verifiedAt?: string;
  occurredAt: string; countsTowardChallenge: boolean; duplicate?: boolean; upgraded?: boolean;
};
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,status TEXT NOT NULL,priority INTEGER NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,type TEXT NOT NULL,cents INTEGER NOT NULL,verified INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, name TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL,fingerprint TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status,priority,created_at);`);
    const columns=this.db.prepare('PRAGMA table_info(tool_calls)').all() as {name:string}[];
    if(!columns.some(c=>c.name==='fingerprint'))this.db.exec("ALTER TABLE tool_calls ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
  }
  close() { this.db.close(); }
  setting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  event(type: string, message: string) {
    this.db.prepare('INSERT INTO events(type,message,created_at) VALUES (?,?,?)').run(type, message.slice(0,4000), new Date().toISOString());
  }
  events(limit = 80) { return this.db.prepare('SELECT id,type,message,created_at as createdAt FROM events ORDER BY id DESC LIMIT ?').all(Math.min(limit,500)); }
  put(kind: string, data: Record<string, unknown>, id = String(data.id || randomUUID())) {
    const previous = this.get(kind, id);
    const record = { ...previous, ...data, id, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,id,JSON.stringify(record));
    return record;
  }
  get(kind: string, id: string): Record<string, any> | undefined {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as {data:string}|undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list(kind: string, limit=100): Record<string,any>[] {
    return (this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC LIMIT ?').all(kind,Math.min(limit,500)) as {data:string}[]).map(x=>JSON.parse(x.data));
  }
  remove(kind: string, id: string) { return this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id).changes; }
  enqueue(input: {title:string; instructions?:string; description?:string; role?:string; priority?:number}): Task {
    if (!input.title?.trim()) throw new Error('Task title is required');
    const roles = ['orchestrator','researcher','builder','operator','finance'];
    if (input.role && !roles.includes(input.role)) throw new Error('Unknown swarm role');
    const now = new Date().toISOString();
    const task: Task = {id:randomUUID(),title:input.title.slice(0,300),instructions:(input.instructions || input.description || input.title).slice(0,16000),role:input.role||'orchestrator',priority:input.priority||0,status:'queued',attempts:0,createdAt:now,updatedAt:now};
    this.db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?)').run(task.id,task.status,task.priority,now,JSON.stringify(task));
    this.event('task.queued',`${task.role}: ${task.title}`);
    return task;
  }
  tasks(status?:string,limit=80):Task[] {
    const sql = status ? 'SELECT data FROM tasks WHERE status=? ORDER BY priority DESC,created_at DESC LIMIT ?' : 'SELECT data FROM tasks ORDER BY created_at DESC LIMIT ?';
    const args = status ? [status,Math.min(limit,500)] : [Math.min(limit,500)];
    return (this.db.prepare(sql).all(...args) as {data:string}[]).map(x=>JSON.parse(x.data));
  }
  task(id:string):Task|undefined {
    const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as {data:string}|undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  updateTask(id:string,patch:Partial<Task>) {
    const task=this.task(id); if(!task) throw new Error('Task not found');
    const next={...task,...patch,id,updatedAt:new Date().toISOString()};
    this.db.prepare('UPDATE tasks SET status=?,priority=?,data=? WHERE id=?').run(next.status,next.priority,JSON.stringify(next),id);
    return next;
  }
  claim(leaseMs:number):Task|undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const candidates=(this.db.prepare('SELECT data FROM tasks WHERE status=\'queued\' ORDER BY priority DESC,created_at ASC').all() as {data:string}[]).map(r=>JSON.parse(r.data) as Task);
      const task=candidates.find(t=>!t.nextAttemptAt || Date.parse(t.nextAttemptAt)<=Date.now());
      if(!task) {this.db.exec('COMMIT');return undefined;}
      const next=this.updateTask(task.id,{status:'running',attempts:task.attempts+1,leaseUntil:new Date(Date.now()+leaseMs).toISOString()});
      this.db.exec('COMMIT'); return next;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  recoverExpired(now=Date.now()) {
    for(const task of this.tasks('running',500)) {
      if(!task.leaseUntil || Date.parse(task.leaseUntil)<now) {
        // Resume an accepted durable session; never blindly replay a task with external actions.
        this.updateTask(task.id,{status:task.sessionId?'recovering':'queued',error:'Worker lease expired; awaiting durable recovery'});
        this.event('task.recovered',task.title);
      }
    }
  }
  ledgerRecord(input:LedgerInput,verified=false,source='reported'):LedgerEntry {
    if(!['income','expense','funding','refund'].includes(input.type)) throw new Error('Invalid ledger type');
    if(!Number.isFinite(input.amountUsd)||input.amountUsd<=0) throw new Error('Amount must be positive and finite');
    if(!input.externalRef?.trim()) throw new Error('Evidence reference required');
    if(verified&&!['stripe','owner'].includes(source)) throw new Error('Verification requires a trusted provider or owner evidence');
    const now=new Date().toISOString();
    const occurredAt=input.occurredAt===undefined?now:new Date(input.occurredAt).toISOString();
    if(input.relatedRef!==undefined&&!input.relatedRef.trim()) throw new Error('Related evidence reference must not be empty');
    const prior=this.db.prepare('SELECT data FROM ledger WHERE reference=?').get(input.externalRef) as {data:string}|undefined;
    const cents=Math.round(input.amountUsd*100);
    if(cents<1 || !Number.isSafeInteger(cents)) throw new Error('Amount must be at least one cent');
    if(verified&&input.type==='refund') {
      if(!input.relatedRef)throw new Error('A verified refund requires its original receipt reference');
      const receipt=this.ledger().find(entry=>entry.externalRef===input.relatedRef&&entry.type==='income'&&entry.verified);
      if(!receipt)throw new Error('Original verified receipt not found');
      const alreadyReturned=this.ledger().filter(entry=>entry.type==='refund'&&entry.verified&&entry.relatedRef===input.relatedRef&&entry.externalRef!==input.externalRef).reduce((sum,entry)=>sum+Math.round(entry.amountUsd*100),0);
      if(alreadyReturned+cents>Math.round(receipt.amountUsd*100))throw new Error('Refund exceeds the original receipt amount');
    }
    if(prior) {
      const existing=JSON.parse(prior.data) as LedgerEntry;
      if(existing.type!==input.type || Math.round(existing.amountUsd*100)!==cents) throw new Error('Conflicting evidence reference');
      if(verified&&(!existing.verified||existing.source===source)) {
        const updated:LedgerEntry={
          ...existing, description:input.description, verified:true, source,
          occurredAt:input.occurredAt===undefined?(existing.occurredAt||existing.createdAt):occurredAt,
          ...(input.relatedRef?{relatedRef:input.relatedRef}:{}),
          ...(input.receiptStatus?{receiptStatus:input.receiptStatus}:{}),
          verifiedAt:existing.verifiedAt||now,
          countsTowardChallenge:input.type==='income'&&(input.receiptStatus||existing.receiptStatus)!=='disputed',
        };
        this.db.prepare('UPDATE ledger SET verified=1,data=? WHERE reference=?').run(JSON.stringify(updated),input.externalRef);
        const upgraded=!existing.verified;
        if(upgraded||existing.receiptStatus!==updated.receiptStatus) this.event('ledger.reconciled',`${source}: ${input.externalRef}`);
        return {...updated,duplicate:!upgraded,upgraded};
      }
      return {...existing,duplicate:true};
    }
    const entry:LedgerEntry={
      type:input.type,amountUsd:cents/100,description:input.description,externalRef:input.externalRef,
      id:randomUUID(),verified,source,createdAt:now,occurredAt,
      ...(verified?{verifiedAt:now}:{}),
      ...(input.relatedRef?{relatedRef:input.relatedRef}:{}),
      ...(verified&&input.receiptStatus?{receiptStatus:input.receiptStatus}:{}),
      countsTowardChallenge:verified&&input.type==='income'&&input.receiptStatus!=='disputed',
    };
    this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?)').run(entry.id,input.externalRef,input.type,cents,verified?1:0,JSON.stringify(entry));
    this.event('ledger.recorded',`${verified?'Verified':'Reported'} ${input.type}: $${entry.amountUsd.toFixed(2)}`);
    return entry;
  }
  ledger():LedgerEntry[] {return (this.db.prepare('SELECT data FROM ledger ORDER BY rowid DESC').all() as {data:string}[]).map(x=>JSON.parse(x.data));}
  revenueTotals(startedAt?:string|null,endsAt?:string|null) {
    const all=this.ledger().filter(entry=>entry.verified);
    const receipts=all.filter(entry=>entry.type==='income'&&(!startedAt||Date.parse(entry.occurredAt||entry.createdAt)>=Date.parse(startedAt))&&(!endsAt||Date.parse(entry.occurredAt||entry.createdAt)<Date.parse(endsAt)));
    const refunds=new Map<string,number>();
    for(const entry of all.filter(entry=>entry.type==='refund'&&entry.relatedRef)) refunds.set(entry.relatedRef!, (refunds.get(entry.relatedRef!)||0)+Math.round(entry.amountUsd*100));
    let gross=0,disputed=0,returned=0,adjustments=0;
    for(const receipt of receipts) {
      const cents=Math.round(receipt.amountUsd*100);
      const refunded=Math.min(cents,refunds.get(receipt.externalRef)||0);
      gross+=cents;returned+=refunded;
      if(receipt.receiptStatus==='disputed') {disputed+=cents;adjustments+=cents;}
      else adjustments+=refunded;
    }
    return {grossReceiptsUsd:gross/100,refundUsd:returned/100,disputedReceiptsUsd:disputed/100,receiptAdjustmentsUsd:adjustments/100,revenueUsd:(gross-adjustments)/100};
  }
  totals() {
    const rows=this.db.prepare('SELECT type,SUM(cents) as cents FROM ledger WHERE verified=1 GROUP BY type').all() as {type:string;cents:number}[];
    const totals=Object.fromEntries(rows.map(x=>[x.type,x.cents/100]));
    const revenue=this.revenueTotals();
    return {...revenue,expenseUsd:totals.expense||0,fundingUsd:totals.funding||0,balanceUsd:(totals.funding||0)+revenue.revenueUsd-(totals.expense||0),netProfitUsd:revenue.revenueUsd-(totals.expense||0)};
  }
  toolCall(id:string) {return this.db.prepare('SELECT status,result,fingerprint FROM tool_calls WHERE id=?').get(id) as {status:string,result:string|null,fingerprint:string}|undefined;}
  beginToolCall(id:string,name:string,fingerprint='') {this.db.prepare('INSERT INTO tool_calls(id,name,status,result,created_at,fingerprint) VALUES (?,?,?,?,?,?)').run(id,name,'running',null,new Date().toISOString(),fingerprint);}
  endToolCall(id:string,result:unknown,status='completed') {this.db.prepare('UPDATE tool_calls SET status=?,result=? WHERE id=?').run(status,JSON.stringify(result),id);}
  modelCosts() {
    const rows=this.db.prepare("SELECT data FROM records WHERE kind='model_cost'").all() as {data:string}[];
    return {reported:rows.length>0,totalUsd:rows.reduce((sum,row)=>sum+Number(JSON.parse(row.data).amountUsd||0),0)};
  }
}
