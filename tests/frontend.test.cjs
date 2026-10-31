const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/app.js'), 'utf8');

function setup(fetch) {
  const nodes = {};
  const removed = [];
  const document = {
    addEventListener() {},
    getElementById: id => nodes[id] || null,
    querySelector: () => null,
    body: { prepend(node) { nodes[node.id] = node; } },
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
  };
  const context = vm.createContext({
    fetch, Response, document, console,
    window: { location: { href: '' } },
    localStorage: { getItem: () => null, removeItem: key => removed.push(key) },
  });
  vm.runInContext(source, context);
  return { context, nodes, removed };
}

test('offline request returns a usable error response and visible message', async () => {
  const { context, nodes } = setup(async () => { throw new TypeError('offline'); });
  const response = await context.apiFetch('/validation/report');
  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /Cannot reach the server/);
  assert.match(nodes.requestError.textContent, /Check that it is running/);
});

test('validation error arrays become readable field messages', async () => {
  const { context } = setup(async () => new Response(JSON.stringify({ detail: [{loc:['body', 'matrix', 'Mon'], msg:'Expected an object'}] }), {status:422}));
  assert.equal((await (await context.apiFetch('/availability/me')).json()).detail, 'matrix.Mon: Expected an object');
});

test('non-JSON server error does not cause another JSON exception', async () => {
  const { context } = setup(async () => new Response('Internal Server Error', {status:500}));
  const response = await context.apiFetch('/generator/generate');
  assert.equal(response.status, 500);
  assert.match((await response.json()).detail, /Request failed/);
});

test('expired sessions clear authentication and redirect to login', async () => {
  const { context, removed } = setup(async () => new Response('{"detail":"Expired"}', {status:401}));
  await context.apiFetch('/auth/me');
  assert.deepEqual(removed, ['token', 'user']);
  assert.equal(context.window.location.href, '/login.html');
});

test('availability initializer never runs on the schedule grid page', async () => {
  let calls = 0;
  const { context, nodes } = setup(async () => { calls++; throw new Error('unexpected request'); });
  nodes.gridTable = {};
  await context.initAvailabilityPage();
  assert.equal(calls, 0);
});

test('Sprint 3 text escaping treats markup as text', () => {
  const { context } = setup();
  assert.equal(context.escapeHTML('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
});

test('generator table shows group labels for generated and reloaded sessions', () => {
  const { context, nodes } = setup();
  nodes.entriesPanel = { style: {} };
  nodes.entriesBody = {};
  context.renderGeneratorEntries([
    { group_code: 'IS-25-AI-2', sub_group: '2' },
    { target_groups: 'CS-26-SOFT', sub_group: '3' },
    { target_groups: 'IS-26-BACK', sub_group: null },
    { group_code: '<group>' },
  ]);
  assert.match(nodes.entriesBody.innerHTML, /<td>IS-25-AI-2<\/td>/);
  assert.match(nodes.entriesBody.innerHTML, /<td>CS-26-SOFT-3<\/td>/);
  assert.match(nodes.entriesBody.innerHTML, /<td>IS-26-BACK<\/td>/);
  assert.match(nodes.entriesBody.innerHTML, /<td>&lt;group&gt;<\/td>/);
});

function generatorNodes(nodes) {
  for (const id of ['generationMode', 'aiPreferences', 'aiDataNotice', 'aiConnectionStatus', 'generateBtn', 'aiDecisionPanel', 'aiDecisionBox', 'progressWrap', 'progressFill', 'progressText', 'statusBanner']) {
    nodes[id] = { style: {}, value: '' };
  }
  nodes.generationMode.value = 'ai_assisted';
}

test('missing API key disables AI generation but permits explicit algorithm mode', () => {
  const { context, nodes } = setup();
  generatorNodes(nodes);
  vm.runInContext('generatorIsAdmin = true; generatorAIStatus = {configured:false};', context);
  context.updateGenerationMode();
  assert.equal(nodes.generateBtn.disabled, true);
  assert.match(nodes.aiConnectionStatus.textContent, /not configured/);
  nodes.generationMode.value = 'heuristic';
  context.updateGenerationMode();
  assert.equal(nodes.generateBtn.disabled, false);
  assert.equal(nodes.aiPreferences.disabled, true);
  assert.match(nodes.aiConnectionStatus.textContent, /no AI model/);
});

test('AI provenance displays escaped model output and marks selected candidate', () => {
  const { context, nodes } = setup();
  generatorNodes(nodes);
  context.renderGenerationMethod({ai_used:true, preferences:'<request>', selection:{provider:'OpenAI', model:'test', candidate_id:'candidate-2', reason:'<script>bad</script>', tradeoffs:['<tradeoff>']}, candidates:[{candidate_id:'candidate-2', strategy:'compact', coverage:100, score:80, early_sessions:0, late_sessions:0, gap_slots:2, average_days_per_subgroup:3}]});
  assert.match(nodes.aiDecisionBox.innerHTML, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(nodes.aiDecisionBox.innerHTML, /<script>/);
  assert.match(nodes.aiDecisionBox.innerHTML, /AI selected/);
  context.renderGenerationMethod({ai_used:false});
  assert.match(nodes.aiDecisionBox.textContent, /No AI model/);
  context.renderGenerationMethod(null);
  assert.match(nodes.aiDecisionBox.textContent, /no recorded AI selection/);
});

test('failed AI call restores controls and keeps previous results visible', async () => {
  let sent;
  const { context, nodes } = setup(async (_, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({detail:'AI request timed out. Previous timetable was preserved.'}), {status:502});
  });
  generatorNodes(nodes);
  nodes.aiPreferences.value = 'Prefer later starts';
  nodes.entriesBody = {innerHTML:'previous timetable'};
  context.setInterval = () => 1;
  context.clearInterval = () => {};
  vm.runInContext('generatorIsAdmin = true; generatorAIStatus = {configured:true};', context);
  await context.runGeneration();
  assert.deepEqual(sent, {mode:'ai_assisted', preferences:'Prefer later starts'});
  assert.equal(nodes.generateBtn.disabled, false);
  assert.equal(nodes.generationMode.disabled, false);
  assert.equal(nodes.entriesBody.innerHTML, 'previous timetable');
  assert.match(nodes.statusBanner.textContent, /Previous timetable was preserved/);
});
