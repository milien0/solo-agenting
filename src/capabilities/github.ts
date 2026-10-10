import { z } from 'zod';
import { define, empty, obj, short, id, text, limit, qs, request } from './shared.js';
import type { CapabilityContext, CapabilityEffect } from './types.js';

export function githubCapabilities(c: CapabilityContext) {
  const repo = { owner: id, repo: id };
  const repoPath = z.string().max(1000).refine(value => !value.startsWith('/') && !/[\\\x00]/.test(value) && !value.split('/').some(segment => segment === '.' || segment === '..'), 'Repository path must be relative without parent segments');
  const api = async (endpoint: string, method = 'GET', data?: unknown) => (await request(c, `https://api.github.com${endpoint}`, { method, headers: { Authorization: `Bearer ${c.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SoloAgentic', ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })).data;
  const prefix = (i: any) => `/repos/${encodeURIComponent(i.owner)}/${encodeURIComponent(i.repo)}`;
  const add = (name: string, description: string, effect: CapabilityEffect, schema: z.ZodType, fn: (i: any) => any) => define(c, name, description, 'github', effect, schema, ['GITHUB_TOKEN'], fn);
  return [
    add('github_user', 'Read the GitHub identity associated with the configured token.', 'read', empty, () => api('/user')),
    add('github_repo_get', 'Read repository metadata and visibility.', 'read', obj(repo), i => api(prefix(i))),
    add('github_repos_list', 'List repositories available to the configured GitHub identity.', 'read', obj({ limit }), i => api('/user/repos?' + qs({ per_page: i.limit, sort: 'updated' }))),
    add('github_repo_search', 'Search GitHub repositories.', 'read', obj({ query: short, limit }), i => api('/search/repositories?' + qs({ q: i.query, per_page: i.limit }))),
    add('github_issues_list', 'List repository issues and pull requests.', 'read', obj({ ...repo, state: z.enum(['open', 'closed', 'all']).default('open'), limit }), i => api(prefix(i) + '/issues?' + qs({ state: i.state, per_page: i.limit }))),
    add('github_issue_get', 'Read one issue.', 'read', obj({ ...repo, number: z.number().int().positive() }), i => api(prefix(i) + `/issues/${i.number}`)),
    add('github_issue_create', 'Create an issue in the specified repository.', 'public', obj({ ...repo, title: short, body: text }), i => api(prefix(i) + '/issues', 'POST', { title: i.title, body: i.body })),
    add('github_issue_update', 'Update title, body or state of an identified issue.', 'public', obj({ ...repo, number: z.number().int().positive(), title: short.optional(), body: text.optional(), state: z.enum(['open', 'closed']).optional() }), i => api(prefix(i) + `/issues/${i.number}`, 'PATCH', { title: i.title, body: i.body, state: i.state })),
    add('github_issue_comment', 'Publish a comment on an identified issue.', 'public', obj({ ...repo, number: z.number().int().positive(), body: text }), i => api(prefix(i) + `/issues/${i.number}/comments`, 'POST', { body: i.body })),
    add('github_contents_get', 'Read a file or directory through the GitHub contents API.', 'read', obj({ ...repo, path: repoPath.default(''), ref: short.optional() }), i => api(prefix(i) + '/contents/' + i.path.split('/').map(encodeURIComponent).join('/') + (i.ref ? '?' + qs({ ref: i.ref }) : ''))),
    add('github_contents_write', 'Commit UTF-8 content; supply current SHA to update an existing file.', 'public', obj({ ...repo, path: repoPath.refine(value => value.length > 0), content: text, message: short, branch: short.optional(), sha: id.optional() }), i => api(prefix(i) + '/contents/' + i.path.split('/').map(encodeURIComponent).join('/'), 'PUT', { message: i.message, content: Buffer.from(i.content).toString('base64'), branch: i.branch, sha: i.sha })),
    add('github_commits_list', 'List recent commits for a repository.', 'read', obj({ ...repo, limit }), i => api(prefix(i) + '/commits?' + qs({ per_page: i.limit }))),
    add('github_branches_list', 'List repository branches.', 'read', obj({ ...repo, limit }), i => api(prefix(i) + '/branches?' + qs({ per_page: i.limit }))),
    add('github_pulls_list', 'List pull requests.', 'read', obj({ ...repo, state: z.enum(['open', 'closed', 'all']).default('open'), limit }), i => api(prefix(i) + '/pulls?' + qs({ state: i.state, per_page: i.limit }))),
    add('github_pull_create', 'Open a pull request from a concrete head branch into a base branch.', 'public', obj({ ...repo, title: short, body: text, head: short, base: short, draft: z.boolean().default(true) }), i => api(prefix(i) + '/pulls', 'POST', { title: i.title, body: i.body, head: i.head, base: i.base, draft: i.draft })),
    add('github_actions_runs', 'List workflow runs and check their status.', 'read', obj({ ...repo, limit }), i => api(prefix(i) + '/actions/runs?' + qs({ per_page: i.limit }))),
    add('github_actions_run_get', 'Read an identified workflow run.', 'read', obj({ ...repo, runId: z.number().int().positive() }), i => api(prefix(i) + `/actions/runs/${i.runId}`)),
    add('github_releases_list', 'List published releases.', 'read', obj({ ...repo, limit }), i => api(prefix(i) + '/releases?' + qs({ per_page: i.limit }))),
  ];
}
