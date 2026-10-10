import { z } from 'zod';
import { define, empty, id, limit, obj, short, text } from './shared.js';
import type { CapabilityContext, CapabilityEffect } from './types.js';

export function runtimeCapabilities(c: CapabilityContext) {
  const add = (name: string, description: string, effect: CapabilityEffect, schema: z.ZodType, operation: string) => define(c, name, description, 'runtime', effect, schema, [], i => c.runtime(operation, i));
  const task = obj({ title: short, description: text.optional(), role: short.optional(), priority: z.number().int().min(0).max(100).default(50) });
  return [
    add('challenge_overview', 'Read challenge goal, deadline, verified revenue and capital.', 'read', empty, 'challenge.overview'),
    add('wallet_provision', 'Create or read the agent-owned Solana wallet and return only its public address and private-vault status; never return secrets, sign transactions or move funds.', 'write', empty, 'wallet.provision'),
    add('ledger_record', 'Record unverified financial evidence with an optional occurrence time or linked receipt; provider or owner reconciliation must verify it before it counts.', 'financial', obj({ type: z.enum(['income', 'expense', 'funding', 'refund']), amountUsd: z.number().finite().positive(), description: short, externalRef: short, relatedRef: short.optional(), occurredAt: z.string().datetime({ offset: true }).optional() }), 'ledger.record'),
    add('ledger_list', 'Read financial ledger entries and verification status.', 'read', obj({ limit }), 'ledger.list'),
    add('memory_save', 'Save durable research or operational memory.', 'write', obj({ key: short, content: text, tags: z.array(short).max(30).default([]) }), 'memory.save'),
    add('memory_search', 'Search durable memory by text query.', 'read', obj({ query: short, limit }), 'memory.search'),
    add('memory_list', 'List recent durable memories.', 'read', obj({ limit }), 'memory.list'),
    add('task_enqueue', 'Enqueue persistent work for a swarm role.', 'write', task, 'task.enqueue'),
    add('task_list', 'List persistent tasks with optional status filtering.', 'read', obj({ status: short.optional(), limit }), 'task.list'),
    add('task_update', 'Queue or cancel inactive work, or store its result; the harness owns active and completed task states.', 'write', obj({ id, status: z.enum(['queued', 'cancelled']).optional(), result: z.unknown().optional() }), 'task.update'),
    add('experiment_create', 'Create an experiment with an explicit hypothesis and optional budget.', 'write', obj({ name: short, hypothesis: text, budgetUsd: z.number().finite().nonnegative().optional(), metric: short.optional() }), 'experiment.create'),
    add('experiment_list', 'List recorded experiments.', 'read', empty, 'experiment.list'),
    add('experiment_update', 'Record experiment status and results.', 'write', obj({ id, status: short.optional(), result: z.unknown().optional() }), 'experiment.update'),
    add('schedule_create', 'Persist an interval schedule that enqueues concrete tasks.', 'write', obj({ name: short, intervalSeconds: z.number().int().min(60).max(2_592_000), task: task.omit({ priority: true }) }), 'schedule.create'),
    add('schedule_list', 'List persistent schedules.', 'read', empty, 'schedule.list'),
    add('schedule_remove', 'Remove one identified schedule.', 'write', obj({ id }), 'schedule.remove'),
    add('artifact_record', 'Record the path or URL of a produced artifact.', 'write', obj({ name: short, path: short, url: z.string().url().optional(), type: short.optional() }), 'artifact.record'),
    add('artifact_list', 'List produced artifacts.', 'read', empty, 'artifact.list'),
    add('swarm_status', 'Read worker and queue status.', 'read', empty, 'swarm.status'),
    add('swarm_delegate', 'Delegate concrete work to another persistent swarm role.', 'write', obj({ title: short, description: text, role: short.optional() }), 'swarm.delegate'),
    add('checkpoint_save', 'Save structured progress before a task yields.', 'write', obj({ name: short, data: z.unknown() }), 'checkpoint.save'),
    add('checkpoint_list', 'Read recent saved checkpoints.', 'read', empty, 'checkpoint.list'),
    add('events_list', 'Read recent audited runtime events.', 'read', obj({ limit }), 'events.list'),
  ];
}
