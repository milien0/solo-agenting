import { z } from 'zod';
import { define, empty, obj, short, id, limit, request, qs, enabled } from './shared.js';
import type { CapabilityContext, CapabilityEffect } from './types.js';

export function stripeCapabilities(c: CapabilityContext) {
  const currency = z.string().regex(/^[a-z]{3}$/);
  const idempotencyKey = z.string().min(8).max(200).regex(/^[\w-]+$/);
  const api = async (endpoint: string, data?: Record<string, unknown>, idempotency?: string) => {
    const params = qs(data ?? {});
    return (await request(c, `https://api.stripe.com/v1${endpoint}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) }, ...(data ? { body: params } : {}) })).data;
  };
  const add = (name: string, description: string, effect: CapabilityEffect, schema: z.ZodType, fn: (i: any) => any) => define(c, name, description, 'stripe', effect, schema, effect === 'read' ? ['STRIPE_SECRET_KEY'] : ['STRIPE_SECRET_KEY', 'STRIPE_CATALOG_WRITE_ENABLED'], i => { if (effect !== 'read') enabled(c, 'STRIPE_CATALOG_WRITE_ENABLED'); return fn(i); });
  return [
    add('stripe_balance', 'Read Stripe available and pending balances.', 'read', empty, () => api('/balance')),
    add('stripe_balance_transactions', 'List balance transactions for revenue and fee reconciliation.', 'read', obj({ limit }), i => api('/balance_transactions?' + qs({ limit: i.limit }))),
    add('stripe_account', 'Read the configured Stripe account and payment capability status.', 'read', empty, () => api('/account')),
    add('stripe_products_list', 'List Stripe product catalog entries.', 'read', obj({ limit }), i => api('/products?' + qs({ limit: i.limit }))),
    add('stripe_product_get', 'Read one Stripe product.', 'read', obj({ id }), i => api(`/products/${encodeURIComponent(i.id)}`)),
    add('stripe_product_create', 'Create a product catalog entry; does not collect or move money.', 'write', obj({ name: short, description: short.optional(), idempotencyKey }), i => api('/products', { name: i.name, description: i.description }, i.idempotencyKey)),
    add('stripe_prices_list', 'List Stripe prices, optionally for one product.', 'read', obj({ product: id.optional(), limit }), i => api('/prices?' + qs({ product: i.product, limit: i.limit }))),
    add('stripe_price_get', 'Read one Stripe price and currency.', 'read', obj({ id }), i => api(`/prices/${encodeURIComponent(i.id)}`)),
    add('stripe_price_create', 'Create a one-time catalog price with a concrete amount in minor currency units.', 'financial', obj({ product: id, unitAmount: z.number().int().positive().max(100_000_000), currency, idempotencyKey }), i => api('/prices', { product: i.product, unit_amount: i.unitAmount, currency: i.currency }, i.idempotencyKey)),
    add('stripe_payment_links_list', 'List hosted payment links.', 'read', obj({ limit }), i => api('/payment_links?' + qs({ limit: i.limit }))),
    add('stripe_payment_link_get', 'Read one hosted payment link.', 'read', obj({ id }), i => api(`/payment_links/${encodeURIComponent(i.id)}`)),
    add('stripe_payment_link_create', 'Create a hosted sales link after verifying a one-time price matches the explicit expected amount and currency.', 'financial', obj({ price: id, quantity: z.number().int().min(1).max(100), expectedUnitAmount: z.number().int().positive().max(100_000_000), currency, idempotencyKey }), async i => { const p = await api(`/prices/${encodeURIComponent(i.price)}`); if (!p.active || p.type !== 'one_time' || p.unit_amount !== i.expectedUnitAmount || p.currency !== i.currency) throw new Error('Price does not match the explicit one-time amount and currency'); return api('/payment_links', { 'line_items[0][price]': i.price, 'line_items[0][quantity]': i.quantity }, i.idempotencyKey); }),
    add('stripe_customers_list', 'List Stripe customers, optionally matching an email.', 'read', obj({ email: z.string().email().optional(), limit }), i => api('/customers?' + qs({ email: i.email, limit: i.limit }))),
    add('stripe_customer_get', 'Read one Stripe customer.', 'read', obj({ id }), i => api(`/customers/${encodeURIComponent(i.id)}`)),
    add('stripe_customer_create', 'Create a Stripe customer record without attaching payment methods or charging.', 'write', obj({ email: z.string().email(), name: short.optional(), idempotencyKey }), i => api('/customers', { email: i.email, name: i.name }, i.idempotencyKey)),
    add('stripe_invoices_list', 'List invoices for payment reconciliation.', 'read', obj({ customer: id.optional(), limit }), i => api('/invoices?' + qs({ customer: i.customer, limit: i.limit }))),
    add('stripe_invoice_get', 'Read one invoice and its paid status.', 'read', obj({ id }), i => api(`/invoices/${encodeURIComponent(i.id)}`)),
    add('stripe_invoice_draft_create', 'Create an empty manual-collection draft invoice with auto-advance disabled; never charge or send it.', 'write', obj({ customer: id, description: short, idempotencyKey }), i => api('/invoices', { customer: i.customer, description: i.description, collection_method: 'send_invoice', days_until_due: 30, auto_advance: false }, i.idempotencyKey)),
    add('stripe_charges_list', 'Read charges including paid/refunded status for verified revenue reconciliation.', 'read', obj({ limit }), i => api('/charges?' + qs({ limit: i.limit }))),
    add('stripe_charge_get', 'Read one charge with actual payment and refund evidence.', 'read', obj({ id }), i => api(`/charges/${encodeURIComponent(i.id)}`)),
    add('stripe_events_list', 'Read recent Stripe events; verify payment objects before crediting revenue.', 'read', obj({ type: short.optional(), limit }), i => api('/events?' + qs({ type: i.type, limit: i.limit }))),
    add('stripe_payment_intents_list', 'Read payment intents and their settlement status.', 'read', obj({ limit }), i => api('/payment_intents?' + qs({ limit: i.limit }))),
  ];
}
