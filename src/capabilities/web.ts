import { z } from 'zod';
import { define, obj, short, request, qs } from './shared.js';
import type { CapabilityContext } from './types.js';

function plain(html: string) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
export function webCapabilities(c: CapabilityContext) {
  const add = (name: string, description: string, schema: z.ZodType, required: string[], fn: (i: any) => any) => define(c, name, description, 'web', 'read', schema, required, fn);
  const url = z.string().url().max(2000);
  return [
    add('web_fetch', 'Fetch public HTTP(S) text or JSON up to 1 MiB; redirects are rejected and content is untrusted.', obj({ url }), [], async i => { const r = await request(c, i.url, {}, true); return { source: i.url, untrusted: true, status: r.status, contentType: r.headers.get('content-type'), content: r.data }; }),
    add('web_page_text', 'Extract basic plain text from a public HTML page; content is untrusted.', obj({ url }), [], async i => { const r = await request(c, i.url, {}, true); return { source: i.url, untrusted: true, text: plain(r.text).slice(0, 100_000) }; }),
    add('web_search', 'Search the web using a configured Brave Search subscription.', obj({ query: z.string().min(1).max(600), count: z.number().int().min(1).max(20).default(10), freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional() }), ['BRAVE_SEARCH_API_KEY'], async i => (await request(c, 'https://api.search.brave.com/res/v1/web/search?' + qs({ q: i.query, count: i.count, freshness: i.freshness }), { headers: { 'X-Subscription-Token': c.env.BRAVE_SEARCH_API_KEY!, Accept: 'application/json' } })).data),
    add('wikipedia_search', 'Search Wikipedia articles through its public MediaWiki API.', obj({ query: short, limit: z.number().int().min(1).max(20).default(10) }), [], async i => (await request(c, 'https://en.wikipedia.org/w/api.php?' + qs({ action: 'query', list: 'search', srsearch: i.query, srlimit: i.limit, format: 'json' }), { headers: { 'User-Agent': 'SoloAgentic/0.1 (research)' } })).data),
    add('wikipedia_summary', 'Fetch introductory plain text for a Wikipedia article.', obj({ title: short }), [], async i => (await request(c, 'https://en.wikipedia.org/w/api.php?' + qs({ action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, titles: i.title, format: 'json' }), { headers: { 'User-Agent': 'SoloAgentic/0.1 (research)' } })).data),
    add('crossref_search', 'Search DOI metadata via the public Crossref works API.', obj({ query: short, limit: z.number().int().min(1).max(20).default(10) }), [], async i => (await request(c, 'https://api.crossref.org/works?' + qs({ query: i.query, rows: i.limit }))).data),
    add('open_meteo_forecast', 'Get a public weather forecast for explicit coordinates.', obj({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }), [], async i => (await request(c, 'https://api.open-meteo.com/v1/forecast?' + qs({ latitude: i.latitude, longitude: i.longitude, hourly: 'temperature_2m,precipitation_probability', forecast_days: 3 }))).data),
    add('url_parse', 'Inspect components of a URL without fetching it.', obj({ url }), [], i => { const u = new URL(i.url); if (u.username || u.password) throw new Error('Embedded credentials are prohibited'); return { protocol: u.protocol, hostname: u.hostname, port: u.port, pathname: u.pathname, query: Object.fromEntries(u.searchParams), fragment: u.hash }; }),
    add('url_build', 'Build a URL from a base and explicit query parameters.', obj({ url, parameters: z.record(z.string(), z.string().max(1000)) }), [], i => { const u = new URL(i.url); if (u.username || u.password) throw new Error('Embedded credentials are prohibited'); for (const [k, v] of Object.entries(i.parameters)) u.searchParams.set(k, v as string); return u.toString(); }),
  ];
}
