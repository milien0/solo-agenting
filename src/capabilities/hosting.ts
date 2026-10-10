import { define, obj, id, limit, request, qs } from './shared.js';
import type { CapabilityContext } from './types.js';

export function hostingCapabilities(c: CapabilityContext) {
  const vercel = async (path: string) => (await request(c, 'https://api.vercel.com' + path, { headers: { Authorization: `Bearer ${c.env.VERCEL_TOKEN}` } })).data;
  const render = async (path: string) => (await request(c, 'https://api.render.com/v1' + path, { headers: { Authorization: `Bearer ${c.env.RENDER_API_KEY}`, Accept: 'application/json' } })).data;
  return [
    define(c, 'vercel_projects_list', 'Read Vercel projects for an explicit optional team.', 'vercel', 'read', obj({ teamId: id.optional(), limit }), ['VERCEL_TOKEN'], i => vercel('/v9/projects?' + qs({ teamId: i.teamId, limit: i.limit }))),
    define(c, 'vercel_project_get', 'Read one Vercel project.', 'vercel', 'read', obj({ id, teamId: id.optional() }), ['VERCEL_TOKEN'], i => vercel(`/v9/projects/${encodeURIComponent(i.id)}?` + qs({ teamId: i.teamId }))),
    define(c, 'vercel_deployments_list', 'Read Vercel deployment status for a concrete project or team.', 'vercel', 'read', obj({ projectId: id.optional(), teamId: id.optional(), limit }), ['VERCEL_TOKEN'], i => vercel('/v6/deployments?' + qs({ projectId: i.projectId, teamId: i.teamId, limit: i.limit }))),
    define(c, 'vercel_deployment_get', 'Read deployment metadata and readiness.', 'vercel', 'read', obj({ id, teamId: id.optional() }), ['VERCEL_TOKEN'], i => vercel(`/v13/deployments/${encodeURIComponent(i.id)}?` + qs({ teamId: i.teamId }))),
    define(c, 'render_services_list', 'Read Render services available to the configured account.', 'render', 'read', obj({ limit }), ['RENDER_API_KEY'], i => render('/services?' + qs({ limit: i.limit }))),
    define(c, 'render_service_get', 'Read an identified Render service configuration and status.', 'render', 'read', obj({ id }), ['RENDER_API_KEY'], i => render(`/services/${encodeURIComponent(i.id)}`)),
    define(c, 'render_deploys_list', 'Read recent deployment records for a Render service.', 'render', 'read', obj({ serviceId: id, limit }), ['RENDER_API_KEY'], i => render(`/services/${encodeURIComponent(i.serviceId)}/deploys?` + qs({ limit: i.limit }))),
    define(c, 'render_deploy_get', 'Read one Render deployment record.', 'render', 'read', obj({ serviceId: id, deployId: id }), ['RENDER_API_KEY'], i => render(`/services/${encodeURIComponent(i.serviceId)}/deploys/${encodeURIComponent(i.deployId)}`)),
  ];
}
