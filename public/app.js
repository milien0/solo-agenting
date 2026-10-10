/* Mission control only renders state supplied by the local runtime. */
'use strict';

const $ = (id) => document.getElementById(id);
const viewNames = { overview: 'Mission control', swarm: 'Agent swarm', tools: 'Tool library', experiments: 'Experiments', activity: 'Activity & ledger' };
const roleDescriptions = {
  orchestrator: 'Turns the mission into a plan, routes work, and coordinates the swarm.',
  researcher: 'Investigates opportunities, checks evidence, and identifies the next useful experiment.',
  builder: 'Builds products, services, and the artifacts needed to deliver them.',
  operator: 'Carries out configured operations and tracks their outcomes.',
  finance: 'Reviews recorded costs, funding, receipts, and financial performance.'
};
let state = null;
let online = false;
let refreshing = false;
let controlBusy = false;
let activeCategory = 'all';
let toastTimer;
let lastUpdated;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== null) node.textContent = String(content);
  return node;
}
function setText(id, content) { $(id).textContent = content; }
function list(value) { return Array.isArray(value) ? value : []; }
function newestFirst(value) { return list(value).slice().sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)); }
function knownNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function money(value) { return knownNumber(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value % 1 ? 2 : 0 }).format(value) : '—'; }
function human(value) { return String(value || 'unknown').replace(/[_.-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function date(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function relative(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not yet';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function statusClass(value) {
  const text = String(value || '').toLowerCase();
  if (/failed|error|unavailable|blocked|attention/.test(text)) return 'error';
  if (/paused|awaiting|pending|setup/.test(text)) return 'paused';
  if (/running|working|ready|active|complete|succeeded|connected/.test(text)) return 'ready';
  return '';
}
function updatePill(id, value) { const node = $(id); node.textContent = human(value); node.className = `pill ${statusClass(value)}`; }
function empty(container, title, message, glyph = '↗') {
  const box = element('div', 'empty-state');
  const icon = element('span', 'empty-glyph', glyph);
  icon.setAttribute('aria-hidden', 'true');
  box.append(icon, element('h3', '', title), element('p', '', message));
  container.append(box);
}
function safeDocsLink(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
}
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${error ? ' error' : ''}`;
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 5500);
}
function enableControls() {
  document.querySelectorAll('[data-requires-api]').forEach((button) => { button.disabled = !online || controlBusy; });
  if (state?.challenge?.startedAt) $('start-challenge-button').disabled = true;
}
function setConnectionStatus(isOnline, error) {
  online = isOnline;
  $('api-alert').hidden = isOnline;
  if (error) setText('api-alert-message', error);
  $('sidebar-status-dot').className = `status-dot ${isOnline ? (state?.runtime?.paused ? 'paused' : 'ready') : 'error'}`;
  setText('sidebar-status-text', isOnline ? 'Local runtime connected' : 'Runtime disconnected');
  if (!isOnline) {
    setText('runtime-badge-label', 'Disconnected');
    $('runtime-badge').querySelector('.status-dot').className = 'status-dot error';
    setText('last-refreshed', lastUpdated ? `Last received ${date(lastUpdated)} · connection lost` : 'No operational data received');
  }
  enableControls();
}
async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const options = { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const response = await fetch(path, options);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('The local server did not return operational data. Start the Solo Agentic runtime and refresh.');
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || payload?.error || payload?.message || `Request failed (${response.status}).`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The local runtime took too long to respond. Check the server and retry.');
    if (error instanceof TypeError) throw new Error('Unable to connect to the local runtime. Start the server and retry.');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $('refresh-button').disabled = true;
  try {
    const payload = await api('/api/status');
    if (!payload || typeof payload !== 'object' || !payload.challenge || !payload.runtime) throw new Error('The server returned an incomplete status. Check the runtime logs and retry.');
    state = payload;
    lastUpdated = new Date().toISOString();
    render();
    setConnectionStatus(true);
  } catch (error) { setConnectionStatus(false, error.message); }
  finally { refreshing = false; $('refresh-button').disabled = false; }
}
function render() {
  renderChallenge();
  renderRuntime();
  renderAgents();
  renderTasks();
  renderExperiments();
  renderToolCategories();
  renderTools();
  renderSetup();
  renderActivity();
  setText('last-refreshed', `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(lastUpdated))}`);
}
function renderChallenge() {
  const challenge = state.challenge;
  const revenue = challenge.revenueUsd;
  setText('goal-value', money(revenue));
  const target = $('target-value');
  target.replaceChildren(document.createTextNode(money(challenge.targetUsd)), element('span', '', 'verified gross revenue target'));
  setText('balance-value', money(challenge.balanceUsd));
  setText('expenses-value', money(challenge.expenseUsd));
  setText('profit-value', money(challenge.netProfitUsd));
  const percent = knownNumber(revenue) && challenge.targetUsd > 0 ? Math.max(0, Math.min(100, revenue / challenge.targetUsd * 100)) : 0;
  $('challenge-progress-fill').style.width = `${percent}%`;
  $('challenge-progress').setAttribute('aria-valuenow', String(Math.round(percent * 10) / 10));
  $('challenge-progress').setAttribute('aria-valuetext', knownNumber(revenue) ? `${money(revenue)} verified gross revenue toward ${money(challenge.targetUsd)}` : 'Revenue not available');
  setText('progress-caption', knownNumber(revenue) ? `${Math.round(percent * 10) / 10}% of revenue target` : 'Awaiting recorded revenue');
  setText('funding-caption', `${money(challenge.initialCapitalUsd)} starting capital · planned`);
  if (challenge.startedAt) {
    setText('challenge-status', human(challenge.status || 'running'));
    setText('days-value', knownNumber(challenge.remainingDays) ? String(Math.max(0, Math.ceil(challenge.remainingDays))) : '—');
    setText('days-label', 'days remaining');
    setText('clock-caption', challenge.endsAt ? `Ends ${date(challenge.endsAt)}` : `Started ${date(challenge.startedAt)}`);
    $('start-challenge-button').replaceChildren(document.createTextNode('Challenge clock started'));
  } else {
    setText('challenge-status', 'Preparation phase');
    setText('days-value', String(challenge.durationDays || 30));
    setText('days-label', 'days, once started');
    setText('clock-caption', 'The clock has not started');
    $('start-challenge-button').replaceChildren(element('span', '', '↗'), document.createTextNode('Start challenge'));
  }
}
function renderRuntime() {
  const runtime = state.runtime;
  const starting = /starting/.test(String(runtime.mode));
  const label = runtime.paused ? 'Paused' : runtime.modelReady ? 'Ready' : starting ? 'Connecting model' : 'Needs model';
  updatePill('runtime-state-pill', runtime.paused ? 'paused' : runtime.modelReady ? 'ready' : 'setup');
  setText('runtime-state-pill', label);
  setText('runtime-badge-label', runtime.paused ? 'Paused' : runtime.mode ? human(runtime.mode) : 'Local runtime');
  $('runtime-badge').querySelector('.status-dot').className = `status-dot ${runtime.paused ? 'paused' : 'ready'}`;
  setText('pause-button', runtime.paused ? 'Resume' : 'Pause');
  setText('workers-value', `${knownNumber(runtime.activeWorkers) ? runtime.activeWorkers : '—'} / ${knownNumber(runtime.maxWorkers) ? runtime.maxWorkers : '—'}`);
  setText('model-value', runtime.modelReady ? 'Connected' : starting ? 'Starting' : 'Needs setup');
  setText('last-cycle-value', relative(runtime.lastTickAt));
  const tools = list(state.tools);
  setText('nav-tool-count', tools.length);
  setText('tool-total-value', tools.length);
  setText('tools-value', tools.filter((tool) => tool.available).length);
  setText('tools-caption', `of ${tools.length} registered capabilities`);
}
function renderAgents() {
  const agents = list(state.agents);
  setText('nav-agent-count', agents.length);
  const compact = $('compact-agents');
  const grid = $('agent-grid');
  compact.replaceChildren(); grid.replaceChildren();
  if (!agents.length) {
    empty(compact, 'No agents registered', 'Agent roles appear when the runtime registers its workers.', '◎');
    empty(grid, 'No agents registered', 'The runtime has not returned any agent roles.', '◎');
    return;
  }
  agents.forEach((agent) => {
    const role = String(agent.role || agent.id || 'agent').toLowerCase();
    const letter = role.charAt(0).toUpperCase();
    const row = element('div', 'compact-agent');
    const name = element('div', 'compact-agent-name', agent.name || human(role));
    name.append(element('span', 'compact-agent-role', human(role)));
    row.append(element('span', `agent-avatar ${roleDescriptions[role] ? role : ''}`, letter), name, element('span', `status-dot ${statusClass(agent.status)}`), element('span', 'compact-agent-status', human(agent.status)));
    compact.append(row);
    const card = element('article', 'agent-card');
    const top = element('div', 'agent-card-top');
    top.append(element('span', `agent-avatar ${roleDescriptions[role] ? role : ''}`, letter), element('h3', '', agent.name || human(role)), element('span', `pill ${statusClass(agent.status)}`, human(agent.status)));
    const tasks = list(state.tasks).filter((task) => task.role === role);
    const foot = element('div', 'agent-card-footer');
    foot.append(element('span', '', 'Assigned tasks'), element('strong', '', tasks.length));
    card.append(top, element('div', 'agent-card-role', human(role)), element('p', 'agent-card-description', roleDescriptions[role] || agent.description || 'A registered worker in the Solo Agentic swarm.'), foot);
    grid.append(card);
  });
}
function taskNode(task) {
  const row = element('article', 'task-item');
  const complete = /complete|success|done/.test(String(task.status));
  const fail = /failed|error/.test(String(task.status));
  const marker = element('span', `task-marker${complete ? ' completed' : fail ? ' failed' : ''}`, complete ? '✓' : fail ? '!' : '·');
  marker.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'task-copy');
  copy.append(element('h3', 'task-title', task.title || 'Untitled task'));
  const meta = element('div', 'task-meta');
  meta.append(element('span', '', human(task.role || 'orchestrator')), element('span', '', '·'), element('span', '', date(task.createdAt)), element('span', `pill ${statusClass(task.status)}`, human(task.status)));
  copy.append(meta);
  if (task.result || task.error) {
    const details = element('details');
    details.append(element('summary', '', task.error ? 'Inspect error' : 'Inspect result'));
    const result = task.error || task.result;
    details.append(element('pre', `task-result${task.error ? ' error' : ''}`, typeof result === 'string' ? result : JSON.stringify(result, null, 2)));
    copy.append(details);
  }
  row.append(marker, copy);
  return row;
}
function renderTasks() {
  const tasks = newestFirst(state.tasks);
  const pending = tasks.filter((task) => !/complete|success|done|failed|cancel/.test(String(task.status)));
  setText('task-count', pending.length);
  setText('all-task-count', `${tasks.length} tasks`);
  const overview = $('overview-tasks'); const all = $('all-tasks');
  overview.replaceChildren(); all.replaceChildren();
  if (!tasks.length) {
    empty(overview, 'Ready for the first move', 'Give the swarm a specific task to research, build, or operate.');
    empty(all, 'A clean work queue', 'Create a task with a title, role, and instructions.');
    return;
  }
  tasks.slice(0, 5).forEach((task) => overview.append(taskNode(task)));
  tasks.forEach((task) => all.append(taskNode(task)));
}
function experimentNode(experiment, index) {
  const card = element('article', 'experiment-card');
  const top = element('div', 'experiment-card-top');
  top.append(element('span', 'experiment-number', `EXPERIMENT ${String(index + 1).padStart(3, '0')}`), element('span', `pill ${statusClass(experiment.status)}`, human(experiment.status)));
  const budget = element('div', 'experiment-budget');
  budget.append(element('span', '', 'Proposed budget ceiling'), element('strong', '', money(experiment.budgetUsd)));
  card.append(top, element('h3', '', experiment.title || 'Untitled experiment'), element('p', '', experiment.hypothesis || 'No hypothesis recorded.'), budget);
  return card;
}
function renderExperiments() {
  const experiments = newestFirst(state.experiments);
  const overview = $('overview-experiments'); const all = $('all-experiments');
  overview.replaceChildren(); all.replaceChildren();
  if (!experiments.length) {
    const box = element('div', 'empty-state wide');
    const text = element('div');
    text.append(element('h3', '', 'Keep the possibilities open'), element('p', '', 'Capture a hypothesis and a budget. Results come from real work.'));
    const button = element('button', 'button secondary', 'Create an experiment');
    button.dataset.requiresApi = '';
    button.addEventListener('click', () => openDialog('experiment-dialog'));
    box.append(element('span', 'empty-glyph', '✳'), text, button);
    overview.append(box);
    empty(all, 'No experiments recorded', 'Start with a testable hypothesis and a proposed budget ceiling.', '✳');
  } else {
    experiments.slice(0, 3).forEach((experiment) => overview.append(experimentNode(experiment, experiments.indexOf(experiment))));
    experiments.forEach((experiment, index) => all.append(experimentNode(experiment, index)));
  }
}
function renderToolCategories() {
  const tools = list(state.tools);
  const categories = [...new Set(tools.map((tool) => tool.category || 'Other'))].sort();
  if (activeCategory !== 'all' && !categories.includes(activeCategory)) activeCategory = 'all';
  const filters = $('category-filters'); filters.replaceChildren();
  [['all', 'All tools'], ...categories.map((category) => [category, human(category)])].forEach(([key, title]) => {
    const button = element('button', `category-button${activeCategory === key ? ' active' : ''}`, title);
    button.setAttribute('aria-pressed', String(activeCategory === key));
    button.append(element('span', '', key === 'all' ? tools.length : tools.filter((tool) => (tool.category || 'Other') === key).length));
    button.addEventListener('click', () => { activeCategory = key; renderToolCategories(); renderTools(); });
    filters.append(button);
  });
}
function renderTools() {
  const query = $('tool-search').value.trim().toLowerCase();
  const readiness = $('tool-readiness').value;
  const tools = list(state.tools).filter((tool) => (activeCategory === 'all' || (tool.category || 'Other') === activeCategory) && (readiness === 'all' || (readiness === 'ready' ? tool.available : !tool.available)) && (!query || `${tool.name} ${tool.description} ${tool.category} ${tool.effect}`.toLowerCase().includes(query)));
  setText('tool-result-count', `${tools.length} ${tools.length === 1 ? 'capability' : 'capabilities'}${query ? ` matching “${$('tool-search').value.trim()}”` : ''}`);
  const grid = $('tool-grid'); grid.replaceChildren();
  if (!tools.length) { empty(grid, 'No matching capabilities', 'Try another search, category, or connection filter.', '⌘'); return; }
  tools.forEach((tool) => {
    const card = element('button', 'tool-card');
    card.type = 'button';
    card.setAttribute('aria-label', `Inspect ${tool.name}`);
    const top = element('div', 'tool-card-top');
    const dot = element('span', `tool-readiness${tool.available ? ' ready' : ''}`);
    dot.setAttribute('aria-label', tool.available ? 'Available' : 'Needs setup');
    top.append(element('span', 'tool-category', human(tool.category || 'Other')), dot);
    const footer = element('div', 'tool-card-footer');
    footer.append(element('span', 'tool-effect', human(tool.effect || 'unspecified')), element('span', '', 'Inspect ↗'));
    card.append(top, element('h3', '', tool.name), element('p', '', tool.description || 'No description supplied.'), footer);
    card.addEventListener('click', () => showTool(tool));
    grid.append(card);
  });
}
function showTool(tool) {
  setText('tool-dialog-title', tool.name);
  setText('tool-dialog-category', human(tool.category || 'Capability'));
  const content = $('tool-dialog-content'); content.replaceChildren();
  content.append(element('p', '', tool.description || 'No description supplied.'));
  [['Connection state', tool.available ? 'Ready to use' : 'Needs configuration'], ['Action effect', human(tool.effect || 'unspecified')]].forEach(([key, value]) => {
    const row = element('div', 'tool-detail-row'); row.append(element('span', '', key), element('strong', '', value)); content.append(row);
  });
  const missing = list(tool.missingEnv);
  if (missing.length) {
    content.append(element('h3', 'section-label', 'Missing environment variables'));
    const envs = element('div', 'env-list'); missing.forEach((name) => envs.append(element('code', 'env-token', name))); content.append(envs);
    content.append(element('p', 'field-hint', 'Set these values in the server environment and restart the runtime.'));
  }
  const schema = tool.inputSchema || tool.schema;
  if (schema) { content.append(element('h3', 'section-label', 'Input schema'), element('pre', 'tool-schema', JSON.stringify(schema, null, 2))); }
  openDialog('tool-dialog');
}
function renderSetup() {
  const connectors = list(state.connectors);
  const ready = connectors.filter((connector) => connector.ready).length;
  setText('connection-summary', `${ready} of ${connectors.length} configured`);
  const instructions = $('setup-instructions'); instructions.replaceChildren();
  const missing = list(state.setup?.missing);
  if (missing.length) instructions.append(element('div', 'missing-summary', `${missing.length} configuration ${missing.length === 1 ? 'value needs' : 'values need'} attention. Credentials belong in the server environment.`));
  if (list(state.setup?.instructions).length) {
    const steps = element('ol'); state.setup.instructions.forEach((instruction) => steps.append(element('li', '', instruction))); instructions.append(steps);
  }
  const container = $('connector-list'); container.replaceChildren();
  if (!connectors.length) { empty(container, 'No connectors reported', 'The runtime has not registered connector configuration.'); return; }
  connectors.forEach((connector) => {
    const card = element('article', 'connector-card');
    const top = element('div', 'connector-card-top');
    top.append(element('h4', '', human(connector.name)), element('span', `pill${connector.ready ? ' ready' : ''}`, connector.ready ? 'Configured' : 'Needs setup'));
    card.append(top);
    const variables = list(connector.requiredEnv);
    if (variables.length) { const envs = element('div', 'env-list'); variables.forEach((name) => envs.append(element('code', 'env-token', name))); card.append(envs); }
    const docs = safeDocsLink(connector.docsUrl);
    if (docs) { const link = element('a', 'docs-link', 'Connection documentation ↗'); link.href = docs; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
    container.append(card);
  });
}
function renderActivity() {
  const events = newestFirst(state.events); const ledger = newestFirst(state.ledger);
  setText('event-count', `${events.length} events`); setText('ledger-count', `${ledger.length} entries`);
  const feed = $('event-list'); const transactions = $('ledger-list'); feed.replaceChildren(); transactions.replaceChildren();
  if (!events.length) empty(feed, 'No events recorded', 'Runtime actions and outcomes will appear here.');
  events.forEach((event) => {
    const item = element('article', 'event-item');
    const copy = element('div', 'event-copy');
    const meta = element('div', 'event-meta'); meta.append(element('span', '', human(event.type)), element('span', '', date(event.createdAt)));
    copy.append(element('p', 'event-message', event.message || 'No event message.'), meta);
    item.append(element('span', `event-point ${statusClass(event.type)}`), copy); feed.append(item);
  });
  if (!ledger.length) empty(transactions, 'No money recorded', 'Verified funding, revenue, and expenses will appear when entered in the ledger.', '≈');
  ledger.forEach((entry) => {
    const item = element('article', 'ledger-item');
    const copy = element('div', 'ledger-copy');
    const evidence = typeof entry.verified === 'boolean' ? (entry.verified ? 'Verified' : 'Reported · excluded from totals') : 'Verification not specified';
    copy.append(element('p', 'ledger-description', entry.description || human(entry.type)), element('div', 'ledger-meta', `${human(entry.type)} · ${date(entry.createdAt)} · ${evidence}`));
    const expense = /expense|cost|debit/.test(String(entry.type));
    const amount = knownNumber(entry.amountUsd) ? `${expense ? '−' : '+'}${money(Math.abs(entry.amountUsd))}` : '—';
    item.append(copy, element('strong', `ledger-amount${expense ? ' expense' : ''}`, amount)); transactions.append(item);
  });
}
function selectView() {
  const candidate = location.hash.slice(1);
  const view = viewNames[candidate] ? candidate : 'overview';
  document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `view-${view}`; });
  document.querySelectorAll('.navigation [data-view]').forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  setText('breadcrumb-title', viewNames[view]);
  document.title = `Solo Agentic — ${viewNames[view]}`;
}
function openDialog(id) {
  if ((id === 'task-dialog' || id === 'experiment-dialog' || id === 'start-dialog') && !online) { showToast('Connect the local runtime before creating work.', true); return; }
  const dialog = $(id);
  if (dialog.open) return;
  dialog.querySelectorAll('.form-error').forEach((node) => { node.hidden = true; node.textContent = ''; });
  if (id === 'start-dialog') $('start-confirmation').checked = false;
  dialog.showModal();
}
async function control(action, message) {
  if (!online || controlBusy) return;
  controlBusy = true; enableControls();
  try { await api('/api/control', { action }); await refresh(); showToast(message); }
  catch (error) { showToast(error.message, true); }
  finally { controlBusy = false; enableControls(); }
}
function wireForm(formId, dialogId, errorId, submit, message) {
  $(formId).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const errorNode = $(errorId); errorNode.hidden = true;
    button.disabled = true;
    try { await submit(form); $(dialogId).close(); form.reset(); await refresh(); showToast(message); }
    catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
    finally { button.disabled = false; }
  });
}

document.querySelectorAll('.dialog-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } }));
document.querySelectorAll('.setup-trigger').forEach((button) => button.addEventListener('click', () => openDialog('setup-dialog')));
document.querySelectorAll('.task-trigger').forEach((button) => button.addEventListener('click', () => openDialog('task-dialog')));
document.querySelectorAll('.experiment-trigger').forEach((button) => button.addEventListener('click', () => openDialog('experiment-dialog')));
$('open-setup').addEventListener('click', () => openDialog('setup-dialog'));
$('start-challenge-button').addEventListener('click', () => openDialog('start-dialog'));
$('run-cycle-button').addEventListener('click', () => control('tick', 'A runtime cycle was requested. Follow its work in the activity feed.'));
$('pause-button').addEventListener('click', () => { const paused = Boolean(state?.runtime?.paused); control(paused ? 'resume' : 'pause', paused ? 'Runtime resumed.' : 'Runtime paused.'); });
['refresh-button', 'retry-button', 'activity-refresh'].forEach((id) => $(id).addEventListener('click', refresh));
$('tool-search').addEventListener('input', () => { if (state) renderTools(); });
$('tool-readiness').addEventListener('change', () => { if (state) renderTools(); });
wireForm('task-form', 'task-dialog', 'task-error', (form) => api('/api/tasks', { title: form.elements.title.value.trim(), role: form.elements.role.value, instructions: form.elements.instructions.value.trim() }), 'Task added to the work queue.');
wireForm('experiment-form', 'experiment-dialog', 'experiment-error', (form) => api('/api/experiments', { title: form.elements.title.value.trim(), hypothesis: form.elements.hypothesis.value.trim(), budgetUsd: Number(form.elements.budgetUsd.value) }), 'Experiment recorded. Its proposed budget has not been spent.');
wireForm('start-form', 'start-dialog', 'start-error', () => api('/api/control', { action: 'start_challenge' }), 'Challenge clock started.');
window.addEventListener('hashchange', selectView);
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === '1' && !document.querySelector('dialog[open]')) { event.preventDefault(); location.hash = 'overview'; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
selectView();
enableControls();
refresh();
setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) refresh(); }, 10000);
