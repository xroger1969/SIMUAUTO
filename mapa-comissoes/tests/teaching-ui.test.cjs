const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('./db-runtime/node_modules/jsdom');

const base = join(__dirname, '../comparador-auto-pro');
const html = readFileSync(join(base, 'index.html'), 'utf8');
const appSource = readFileSync(join(base, 'app-v2.js'), 'utf8').replace(/^import .*;\n/gm, '');
const voiceSource = readFileSync(join(base, 'voice-input.js'), 'utf8').replace(/^export /gm, '');
const {normalizeVehicleIdentity} = require('../comparador-auto-pro/commercial-identity.js');
const importSource = name => import('data:text/javascript;base64,' + Buffer.from(readFileSync(join(base, name), 'utf8')).toString('base64'));
const modules = Promise.all([importSource('valuation.js'), importSource('memory.js'), importSource('input.js')]);
const owner = '11111111-1111-4111-8111-111111111111';
const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const vehicle = {make: 'Tesla', model: 'Model Y', trim: 'Long Range', fuel: 'electric', drivetrain: 'AWD', battery_kwh: 75, year: 2023, mileage_km: 50000, registration: 'AA-00-AA', price: 20000};
const statement = 'Este modelo vende-se devagar e os anúncios estão sobrevalorizados.';
const defaultReply = () => ({ok: true, action: 'conversation', reply: 'Qual consideras ser um preço de revenda realista?', should_save_memory: false, memory_rule: null, feedback_proposal: null});
const observationReply = () => ({...defaultReply(), should_save_memory: true, memory_rule: {
  rule_type: 'liquidity', statement, source_quote: statement, confidence: .5,
  scope: {make: vehicle.make, model: vehicle.model, trim: normalizeVehicleIdentity(vehicle).trim, fuel: vehicle.fuel, year_min: 2023, year_max: 2023},
  effect: {mode: 'advisory', liquidity_bias: 0, risk_reserve_eur: 0, margin_delta_eur: 0, note: statement},
}});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
async function until(predicate, message = 'The UI operation did not finish') {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw Error(message);
}

async function boot({rows = new Map(), ai = defaultReply, transcribe = async () => statement} = {}) {
  const [engine, memory, input] = await modules;
  const dom = new JSDOM(html, {url: 'https://example.test/comparador-auto-pro/', runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window;
  const requests = [], messages = [], recorders = [], streams = [], refinements = [];
  const failures = {write: false};
  let authChanged = () => {};
  function query(table) {
    let filters = [], action = null, payload = null, single = false, cached;
    function execute() {
      if (cached) return cached;
      if (table === 'cap_messages') {
        if (action === 'insert') messages.push(structuredClone(payload));
        return cached = {data: [], count: messages.length, error: null};
      }
      if (table !== 'cap_memory_rules') return cached = {data: single ? null : [], count: 0, error: null};
      if (failures.write && action) return cached = {data: null, error: {message: 'Write rejected'}};
      if (action === 'upsert') rows.set(payload.id, structuredClone(payload));
      let data = [...rows.values()].filter(row => filters.every(([key, value]) => row[key] === value));
      if (action === 'update') {
        data.forEach(row => rows.set(row.id, {...row, ...payload}));
        data = data.map(row => rows.get(row.id));
      }
      if (action === 'upsert') data = [rows.get(payload.id)];
      return cached = {data: single ? data[0] || null : structuredClone(data), count: data.length, error: null};
    }
    const api = {
      select() { return api; }, eq(key, value) { filters.push([key, value]); return api; },
      order() { return api; }, limit() { return api; },
      upsert(row) { action = 'upsert'; payload = row; return api; },
      insert(row) { action = 'insert'; payload = row; return api; },
      update(patch) { action = 'update'; payload = patch; return api; },
      single() { single = true; return Promise.resolve(execute()); },
      maybeSingle() { single = true; return Promise.resolve(execute()); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return api;
  }
  const db = {from: query, auth: {
    getSession: async () => ({data: {session: null}}),
    onAuthStateChange(fn) { authChanged = fn; },
  }};
  w.supabase = {createClient: () => db};
  w.evaluateBasePurchase = engine.evaluatePurchase;
  w.buildFeedbackRecord = engine.buildFeedbackRecord;
  w.feedbackRecordId = (...args) => engine.feedbackRecordId(...args, webcrypto);
  w.relevantMemories = memory.relevantMemories;
  Object.assign(w, input);
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w.navigator, 'mediaDevices', {value: {
    getUserMedia: async () => {
      const track = new w.EventTarget(); track.stopped = false; track.stop = () => { track.stopped = true; };
      const stream = {getTracks: () => [track]}; streams.push(stream); return stream;
    },
  }});
  w.MediaRecorder = class {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    constructor(stream, {mimeType = 'audio/mp4'} = {}) {
      this.stream = stream; this.mimeType = mimeType; this.state = 'inactive'; recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      w.queueMicrotask(() => {
        this.ondataavailable?.({data: new w.Blob(['audio'.repeat(100)], {type: this.mimeType})});
        this.onstop?.();
      });
    }
  };
  // Execute the real module in the DOM realm so its Blob is compatible with FileReader.
  w.eval(voiceSource + '\n;globalThis.createVoiceInput=createVoiceInput;');
  w.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({url, body, signal: options.signal});
    if (url === '/api/comparador-ai') return {ok: true, status: 200, json: async () => ai(body)};
    if (url === '/api/comparador-transcribe') {
      const text = await transcribe(body, options);
      return {ok: true, status: 200, json: async () => ({ok: true, text})};
    }
    throw Error('Unexpected external request: ' + url);
  };
  w.eval(appSource + `\n;globalThis.teachingHarness={
    setState(owner,id,vehicle,result){session={user:{id:owner},access_token:'test'};currentAnalysisId=id;currentVehicle=vehicle;currentResult=result;currentHistoryRevision=null;currentMarketData={marketPayload:{url:null}};lastAnalysisContext=currentMarketData;},
    load:loadMemories,evaluate:evaluatePurchase,send:sendTeachingMessage,
    reset(){resetAnalysisView({announce:false,focus:false,scroll:false});},
    close:closeRefineDialog,cancelVoice:cancelVoiceInput,
    setRefiner(callback){refineEvaluation=callback;},
    setAwaiting(value){awaitingVehicleDetails=value;},
    get busy(){return activeOperation!==null;},get cached(){return learningRulesCache;},
    get voiceState(){return voiceInput?.state||'idle';},get result(){return currentResult;}
  };`);
  await new Promise(resolve => setTimeout(resolve, 0));
  const comparables = [1, 2, 3].map(index => ({...vehicle, registration: 'BB-' + index + '-CC', price: 30000 + index * 100,
    url: 'https://stand' + index + '.example/car', seller_type: 'professional', country: 'PT', price_basis: 'gross', availability: 'available',
    observed_at: new Date().toISOString(), evidence: {verified: true, observed_at: new Date().toISOString(), source_url_verified: true}}));
  const valuationInput = {subject: vehicle, comparables, current_purchase_price: 20000};
  const result = engine.evaluatePurchase(valuationInput);
  w.teachingHarness.setState(owner, caseId, vehicle, result);
  const h = w.teachingHarness;
  const q = id => w.document.getElementById(id);
  return {dom, w, h, q, rows, requests, messages, recorders, streams, refinements, failures, result, valuationInput,
    authChanged: (...args) => authChanged(...args),
    dispose() { h.cancelVoice(); dom.window.close(); },
  };
}

async function submit(app, text, formId = 'teachingForm', inputId = 'teachingInput') {
  app.q(inputId).value = text;
  app.q(formId).dispatchEvent(new app.w.Event('submit', {bubbles: true, cancelable: true}));
  await until(() => !app.h.busy);
}
const chatRequests = app => app.requests.filter(request => request.url === '/api/comparador-ai');

test('conversation saves qualitative teaching, reloads it for the next chat, and does not research or recalculate market', async () => {
  const a = await boot({ai: observationReply});
  try {
    await submit(a, statement, 'refineForm', 'refineInput');
    assert.equal(a.rows.size, 1);
    const [row] = [...a.rows.values()];
    assert.equal(row.effect.mode, 'advisory');
    assert.equal(row.effect.source, 'user_observation');
    assert.equal(row.scope.model, vehicle.model);
    assert.equal(a.h.result, a.result);
    assert.match(a.q('refineDialogState').textContent, /Orientação guardada/);
    assert.deepEqual(a.requests.map(request => request.url), ['/api/comparador-ai']);
    const b = await boot({rows: a.rows});
    try {
      await b.h.load();
      await submit(b, 'O que deves considerar na próxima avaliação deste modelo?');
      assert.equal(chatRequests(b)[0].body.context.dealer_memories[0].statement, statement);
      assert.equal(b.h.evaluate(b.valuationInput).market.saleLikely, b.result.market.saleLikely);
    } finally { b.dispose(); }
  } finally { a.dispose(); }
});

test('numeric feedback is saved only after confirmation and changes a subsequent assessment', async () => {
  const a = await boot({ai: () => ({...defaultReply(), feedback_proposal: {kind: 'retail_estimate', value: 26000, source_quote: '26000 euros'}})});
  try {
    await submit(a, 'O preço realista de revenda é 26000 euros.');
    assert.equal(a.rows.size, 0);
    assert.equal(a.q('teachingFeedback').hidden, false);
    assert.equal(a.h.evaluate(a.valuationInput).market.saleLikely, a.result.market.saleLikely);
    a.q('teachingFeedbackSave').click();
    await until(() => !a.h.busy);
    assert.equal(a.rows.size, 1);
    assert.equal([...a.rows.values()][0].effect.kind, 'retail_estimate');
    assert.equal([...a.rows.values()][0].effect.value, 26000);
    assert.match(a.q('refineDialogState').textContent, /Aprendizagem guardada/);
    assert.equal(a.h.evaluate(a.valuationInput).market.saleLikely, a.result.market.saleLikely);
    a.h.setState(owner, nextId, vehicle, a.result);
    assert.ok(a.h.evaluate(a.valuationInput).market.saleLikely < a.result.market.saleLikely);
    assert.equal(chatRequests(a).length, 1);
  } finally { a.dispose(); }
});

test('database rejection keeps text retryable and never claims successful learning; retry is idempotent', async () => {
  const a = await boot({ai: observationReply});
  try {
    a.failures.write = true;
    await submit(a, statement);
    assert.equal(a.rows.size, 0);
    assert.equal(a.q('teachingInput').value, statement);
    assert.match(a.q('refineDialogState').textContent, /Não foi possível concluir/);
    assert.doesNotMatch(a.q('refineDialogMessages').textContent, /Orientação guardada/);
    a.failures.write = false;
    await submit(a, statement);
    const id = [...a.rows.keys()][0];
    await submit(a, statement);
    assert.equal(a.rows.size, 1);
    assert.equal([...a.rows.keys()][0], id);
    assert.match(a.q('refineDialogState').textContent, /Orientação guardada/);
  } finally { a.dispose(); }
});

test('different observations on the same car accumulate without turning retries into duplicates', async () => {
  const a = await boot({ai: body => {
    const response = observationReply();
    response.memory_rule.statement = body.message;
    response.memory_rule.source_quote = body.message;
    return response;
  }});
  try {
    await submit(a, statement);
    const other = 'Os clientes procuram sobretudo exemplares com poucos quilómetros.';
    await submit(a, other);
    assert.equal(a.rows.size, 2);
    await submit(a, other);
    assert.equal(a.rows.size, 2);
    assert.deepEqual(new Set([...a.rows.values()].map(row => row.statement)), new Set([statement, other]));
  } finally { a.dispose(); }
});

test('a completed AI turn does not reopen the conversation after the user closes it', async () => {
  const pending = deferred();
  const a = await boot({ai: () => pending.promise});
  try {
    const sending = a.h.send(statement);
    await until(() => chatRequests(a).length === 1);
    a.h.close();
    assert.equal(a.q('refineDialog').classList.contains('hidden'), true);
    pending.resolve(observationReply());
    await sending;
    assert.equal(a.rows.size, 1);
    assert.equal(a.q('refineDialog').classList.contains('hidden'), true);
  } finally { a.dispose(); }
});

test('numeric confirmation failure keeps the proposal available without reporting that it was saved', async () => {
  const a = await boot({ai: () => ({...defaultReply(), feedback_proposal: {kind: 'retail_estimate', value: 26000, source_quote: '26000 euros'}})});
  try {
    await submit(a, 'Para revenda considero 26000 euros.');
    a.failures.write = true;
    await submit(a, 'Sim, confirmo.');
    assert.equal(a.rows.size, 0);
    assert.equal(a.q('teachingFeedback').hidden, false);
    assert.match(a.q('refineDialogState').textContent, /Não foi possível guardar/);
    assert.doesNotMatch(a.q('refineDialogMessages').textContent, /Será considerada nas próximas avaliações/);
    a.failures.write = false;
    await submit(a, 'Sim, confirmo.');
    assert.equal(a.rows.size, 1);
    assert.equal(a.q('teachingFeedback').hidden, true);
    assert.equal(chatRequests(a).length, 1);
  } finally { a.dispose(); }
});

test('real microphone module routes vehicle dictation to search and teaching dictation to the current car conversation', async () => {
  let transcript = 'Tesla Model Y Long Range de 2023';
  const a = await boot({transcribe: async () => transcript});
  try {
    a.q('micBtn').click();
    await until(() => a.h.voiceState === 'recording');
    a.q('micBtn').click();
    await until(() => a.h.voiceState === 'idle');
    assert.equal(a.q('vehicleUrl').value, transcript);
    assert.equal(chatRequests(a).length, 0);
    transcript = statement;
    a.q('refineMicBtn').click();
    await until(() => a.h.voiceState === 'recording');
    assert.equal(a.q('refineDialog').classList.contains('hidden'), false);
    assert.equal(a.q('teachingMicBtn').getAttribute('aria-pressed'), 'true');
    a.q('teachingMicBtn').click();
    await until(() => a.h.voiceState === 'idle' && !a.h.busy && chatRequests(a).length === 1);
    const request = chatRequests(a)[0];
    assert.equal(request.body.message, statement);
    assert.equal(request.body.analysis_id, caseId);
    assert.equal(request.body.context.vehicle.model, vehicle.model);
    assert.ok(a.streams.every(stream => stream.getTracks().every(track => track.stopped)));
    assert.ok(a.requests.filter(request => request.url === '/api/comparador-transcribe').every(request => request.body.audio_data_url.startsWith('data:audio/mp4;base64,')));
  } finally { a.dispose(); }
});

test('resetting the assessment discards a late transcription instead of teaching a different car', async () => {
  const pending = deferred();
  const a = await boot({transcribe: () => pending.promise});
  try {
    a.q('refineMicBtn').click();
    await until(() => a.h.voiceState === 'recording');
    a.q('teachingMicBtn').click();
    await until(() => a.requests.some(request => request.url === '/api/comparador-transcribe'));
    a.h.reset();
    a.h.setState(owner, nextId, {...vehicle, model: 'Model 3'}, a.result);
    pending.resolve(statement);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(chatRequests(a).length, 0);
    assert.equal(a.q('teachingInput').value, '');
    assert.equal(a.rows.size, 0);
    assert.equal(a.requests.find(request => request.url === '/api/comparador-transcribe').signal.aborted, true);
  } finally { a.dispose(); }
});

test('signing out cancels the pending microphone request and does not deliver its transcript', async () => {
  const pending = deferred();
  const a = await boot({transcribe: () => pending.promise});
  try {
    a.q('refineMicBtn').click();
    await until(() => a.h.voiceState === 'recording');
    a.q('teachingMicBtn').click();
    await until(() => a.requests.some(request => request.url === '/api/comparador-transcribe'));
    a.authChanged('SIGNED_OUT', null);
    pending.resolve(statement);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(chatRequests(a).length, 0);
    assert.equal(a.h.voiceState, 'idle');
    assert.equal(a.q('refineDialog').classList.contains('hidden'), true);
  } finally { a.dispose(); }
});

test('vehicle corrections still enter refinement, while pending identity details bypass chat classification', async () => {
  const a = await boot({ai: () => ({...defaultReply(), action: 'refine'})});
  try {
    a.h.setRefiner(async (text, options) => a.refinements.push({text, options}));
    await submit(a, 'Corrige a versão para Performance.');
    assert.equal(a.refinements.length, 1);
    assert.equal(a.refinements[0].text, 'Corrige a versão para Performance.');
    assert.equal(a.refinements[0].options.alreadyShown, true);
    assert.equal(a.refinements[0].options.aiData.action, 'refine');
    assert.equal(a.rows.size, 0);
    a.h.setAwaiting(true);
    await submit(a, 'É Long Range AWD.');
    assert.equal(a.refinements.length, 2);
    assert.equal(chatRequests(a).length, 1);
  } finally { a.dispose(); }
});
