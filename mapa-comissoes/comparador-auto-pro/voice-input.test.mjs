import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('./voice-input.js', import.meta.url), 'utf8');
const {createVoiceInput} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const context = {analysisId: 'car-a', userId: 'owner', target: 'teaching'};
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

function harness(options = {}) {
  const recorders = [], transcripts = [], errors = [], states = [], uploads = [];
  let stopped = 0;
  const track = new EventTarget();
  track.stop = () => { stopped += 1; };
  const stream = {getTracks: () => [track]};
  class Recorder {
    static isTypeSupported(type) { return options.supportedType ? type === options.supportedType : true; }
    constructor(input, settings = {}) {
      this.stream = input;
      this.settings = settings;
      this.mimeType = settings.mimeType || options.defaultType || 'audio/mp4';
      this.state = 'inactive';
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    chunk(text, type = this.mimeType) { this.ondataavailable?.({data: new Blob([text], {type})}); }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        if (options.lastChunk) this.chunk(options.lastChunk, options.defaultType || this.mimeType);
        if (options.clearMimeOnStop) this.mimeType = '';
        this.onstop?.();
      });
    }
  }
  const voice = createVoiceInput({
    isContextCurrent: options.isContextCurrent || (() => true),
    getUserMedia: options.getUserMedia || (async () => stream),
    MediaRecorderClass: options.MediaRecorderClass || Recorder,
    maxDurationMs: options.maxDurationMs,
    maxBytes: options.maxBytes,
    stopFinalizeTimeoutMs: options.stopFinalizeTimeoutMs,
    onState: value => { states.push(value); options.onState?.(value); },
    onText: (text, ctx) => transcripts.push({text, context: ctx, state: voice.state}),
    onError: (error, ctx) => errors.push({error, context: ctx}),
    transcribe: async (blob, details) => {
      uploads.push({blob, ...details});
      return options.transcribe ? options.transcribe(blob, details) : 'Este modelo vende-se devagar.';
    },
  });
  return {voice, recorders, transcripts, errors, states, uploads, track, stream, stopped: () => stopped};
}

test('waits for the final chunk, preserves the real container, and becomes idle before delivering text', async () => {
  const h = harness({supportedType: 'audio/mp4', lastChunk: 'b'.repeat(160), clearMimeOnStop: true});
  await h.voice.toggle(context);
  h.recorders[0].chunk('a'.repeat(160));
  h.voice.stop();
  assert.equal(h.voice.state, 'transcribing');
  assert.equal(h.uploads.length, 0);
  await flush();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].blob.type, 'audio/mp4');
  assert.equal(await h.uploads[0].blob.text(), 'a'.repeat(160) + 'b'.repeat(160));
  assert.equal(h.transcripts[0].state, 'idle');
  assert.equal(h.transcripts[0].text, 'Este modelo vende-se devagar.');
  assert.deepEqual(h.transcripts[0].context, context);
  assert.ok(h.stopped() > 0);
});

test('late microphone permission after cancellation stops every track without recording or uploading', async () => {
  const permission = deferred();
  const h = harness({getUserMedia: () => permission.promise});
  const starting = h.voice.toggle(context);
  assert.equal(h.voice.state, 'requesting');
  h.voice.cancel();
  permission.resolve(h.stream);
  await starting;
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.recorders.length, 0);
  assert.equal(h.stopped(), 1);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.transcripts.length, 0);
});

test('cancellation aborts pending transcription and ignores a late server result', async () => {
  const transcription = deferred();
  const h = harness({lastChunk: 'a'.repeat(160), transcribe: () => transcription.promise});
  await h.voice.toggle(context);
  h.voice.stop();
  await flush();
  h.voice.cancel();
  assert.equal(h.uploads[0].signal.aborted, true);
  transcription.resolve('Wrong assessment');
  await flush();
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.transcripts.length, 0);
  assert.equal(h.errors.length, 0);
});

test('a changed assessment cannot receive a pending transcript, even without an explicit cancel', async () => {
  const transcription = deferred();
  let selected = 'car-a';
  const h = harness({
    lastChunk: 'a'.repeat(160),
    transcribe: () => transcription.promise,
    isContextCurrent: ctx => ctx.analysisId === selected,
  });
  await h.voice.toggle(context);
  h.voice.stop();
  await flush();
  selected = 'car-b';
  transcription.resolve('This belongs to car A');
  await flush();
  assert.equal(h.transcripts.length, 0);
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.uploads[0].signal.aborted, true);
});

test('changing assessment while permission is pending releases the newly acquired microphone', async () => {
  const permission = deferred();
  let selected = 'car-a';
  const h = harness({getUserMedia: () => permission.promise, isContextCurrent: ctx => ctx.analysisId === selected});
  const starting = h.voice.toggle(context);
  selected = 'car-b';
  permission.resolve(h.stream);
  await starting;
  assert.equal(h.stopped(), 1);
  assert.equal(h.recorders.length, 0);
  assert.equal(h.voice.state, 'idle');
});

test('permission denial returns to idle with an actionable Portuguese message', async () => {
  const h = harness({getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); }});
  await h.voice.toggle(context);
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.errors[0].error.code, 'voice_permission');
  assert.match(h.errors[0].error.message, /Permite o acesso ao microfone/);
  assert.equal(h.uploads.length, 0);
});

test('empty recordings and empty transcriptions do not become teaching messages', async () => {
  const empty = harness();
  await empty.voice.toggle(context);
  empty.voice.stop();
  await flush();
  assert.equal(empty.errors[0].error.code, 'voice_empty');
  assert.equal(empty.uploads.length, 0);
  const silence = harness({lastChunk: 'a'.repeat(160), transcribe: async () => '  '});
  await silence.voice.toggle(context);
  silence.voice.stop();
  await flush();
  assert.equal(silence.errors[0].error.code, 'voice_no_speech');
  assert.equal(silence.transcripts.length, 0);
  assert.equal(silence.voice.state, 'idle');
});

test('oversized capture is stopped and discarded before an upload starts', async () => {
  const h = harness({maxBytes: 200});
  await h.voice.toggle(context);
  h.recorders[0].chunk('a'.repeat(201));
  await flush();
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.errors[0].error.code, 'voice_size');
  assert.equal(h.uploads.length, 0);
  assert.ok(h.stopped() > 0);
});

test('microphone interruption releases capture and cannot submit a partial teaching turn', async () => {
  const h = harness({lastChunk: 'a'.repeat(160)});
  await h.voice.toggle(context);
  h.track.dispatchEvent(new Event('ended'));
  await flush();
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.errors[0].error.code, 'voice_interrupted');
  assert.equal(h.uploads.length, 0);
  assert.ok(h.stopped() > 0);
});

test('transcription failures release the recorder and allow a new attempt', async () => {
  const h = harness({lastChunk: 'a'.repeat(160), transcribe: async () => { throw new Error('Sem ligação à Internet.'); }});
  await h.voice.toggle(context);
  h.voice.stop();
  await flush();
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.errors[0].error.message, 'Sem ligação à Internet.');
  await h.voice.toggle(context);
  assert.equal(h.voice.state, 'recording');
  h.voice.cancel();
});

test('duration limit finishes the recording and disallows duplicate starts during transcription', async () => {
  const pending = deferred();
  const h = harness({maxDurationMs: 5, lastChunk: 'a'.repeat(160), transcribe: () => pending.promise});
  await h.voice.toggle(context);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.voice.state, 'transcribing');
  await h.voice.toggle(context);
  assert.equal(h.recorders.length, 1);
  assert.equal(h.uploads.length, 1);
  pending.resolve('Texto');
  await flush();
  assert.equal(h.transcripts.length, 1);
  assert.equal(h.voice.state, 'idle');
});

test('default recorder format is kept when supported MIME types cannot be selected', async () => {
  const h = harness({supportedType: 'unsupported', defaultType: 'audio/mp4', clearMimeOnStop: true, lastChunk: 'a'.repeat(160)});
  await h.voice.toggle(context);
  assert.equal(h.recorders[0].settings.mimeType, undefined);
  h.voice.stop();
  await flush();
  assert.equal(h.uploads[0].blob.type, 'audio/mp4');
  assert.equal(h.errors.length, 0);
});

test('recorder initialization failure still releases an already granted microphone', async () => {
  class BrokenRecorder {
    static isTypeSupported() { return false; }
    constructor() { throw new DOMException('Encoder not available', 'NotSupportedError'); }
  }
  const h = harness({MediaRecorderClass: BrokenRecorder});
  await h.voice.toggle(context);
  assert.equal(h.voice.state, 'idle');
  assert.equal(h.stopped(), 1);
  assert.equal(h.errors[0].error.code, 'voice_unsupported_format');
  assert.equal(h.uploads.length, 0);
});

test('a late permission from a cancelled turn cannot interrupt a newer recording', async () => {
  const permission = deferred();
  let calls = 0, oldStopped = 0;
  const oldStream = {getTracks: () => [{stop: () => { oldStopped += 1; }}]};
  const h = harness({getUserMedia: () => ++calls === 1 ? permission.promise : Promise.resolve(h.stream)});
  const oldStart = h.voice.toggle(context);
  h.voice.cancel();
  await h.voice.toggle({...context, analysisId: 'car-b'});
  permission.resolve(oldStream);
  await oldStart;
  assert.equal(oldStopped, 1);
  assert.equal(h.stopped(), 0);
  assert.equal(h.voice.state, 'recording');
  assert.equal(h.recorders.length, 1);
  h.voice.cancel();
});

test('temporary iPhone mute does not discard the recording', async () => {
  const h=harness({supportedType:'audio/mp4',lastChunk:'a'.repeat(160)});
  await h.voice.toggle(context);
  h.track.dispatchEvent(new Event('mute'));
  assert.equal(h.voice.state,'recording');
  h.voice.stop();
  await flush();
  assert.equal(h.errors.length,0);
  assert.equal(h.transcripts.length,1);
});
test('recorder.stop keeps microphone tracks running until final MP4 data is flushed',async()=>{
  const h=harness({supportedType:'audio/mp4',lastChunk:'a'.repeat(160)});
  await h.voice.toggle(context);
  h.voice.stop();
  assert.equal(h.stopped(),0);
  await flush();
  assert.equal(h.stopped(),1);
  assert.equal(h.uploads.length,1);
});
test('WebKit recorder never finishing shows an actionable error',async()=>{
  class HungRecorder{
    static isTypeSupported(m){return m==='audio/mp4'}
    constructor(){this.mimeType='audio/mp4';this.state='inactive'}
    start(){this.state='recording'}
    stop(){this.state='inactive'}
  }
  const h=harness({MediaRecorderClass:HungRecorder,stopFinalizeTimeoutMs:6});
  await h.voice.toggle(context);
  h.voice.stop();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(h.voice.state,'idle');
  assert.equal(h.errors[0].error.code,'voice_stop_timeout');
  assert.ok(h.stopped()>0);
});
