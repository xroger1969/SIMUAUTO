/** Microphone capture shared by the vehicle input and the teaching conversation. */
export function createVoiceInput({
  isContextCurrent = () => true,
  onState = () => {},
  onText = () => {},
  onError = () => {},
  transcribe,
  getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices),
  MediaRecorderClass = globalThis.MediaRecorder,
  maxDurationMs = 90_000,
  maxBytes = 2_800_000,
  stopFinalizeTimeoutMs = 8_000,
} = {}) {
  let state = 'idle';
  let active = null;
  let generation = 0;

  const voiceError = (message, code) => Object.assign(new Error(message), {code});
  const contextMatches = context => {
    try { return Boolean(isContextCurrent(context)); } catch { return false; }
  };
  const owns = session => active === session && !session.cancelled;
  const current = session => owns(session) && contextMatches(session.context);
  const elapsed = session => session?.startedAt ? Math.floor((Date.now() - session.startedAt) / 1000) : 0;

  function updateState(next, session = active) {
    state = next;
    onState({state, elapsedSeconds: next === 'idle' ? 0 : elapsed(session)});
  }

  function stopTracks(stream) {
    for (const track of stream?.getTracks?.() || []) {
      try { track.stop(); } catch { /* Release every remaining track even if one fails. */ }
    }
  }

  function release(session, complete = true) {
    clearInterval(session.interval);
    clearTimeout(session.deadline);
    clearTimeout(session.stopTimer);
    if (complete) {
      for (const remove of session.removeListeners) remove();
      session.removeListeners.length = 0;
    }
    stopTracks(session.stream);
  }

  function listen(session, target, event, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, handler);
    session.removeListeners.push(() => target.removeEventListener(event, handler));
  }

  function cancel() {
    const session = active;
    generation += 1;
    active = null;
    if (session) {
      session.cancelled = true;
      session.controller.abort();
      // Invalidate first: stop() may synchronously dispatch events in an implementation.
      try {
        if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
      } catch { /* The microphone tracks are still released below. */ }
      release(session);
      session.chunks.length = 0;
    }
    updateState('idle');
  }

  function finish(session) {
    if (!owns(session)) return false;
    active = null;
    release(session);
    session.chunks.length = 0;
    updateState('idle');
    return generation === session.id && contextMatches(session.context);
  }

  function fail(session, error) {
    if (!owns(session)) return;
    if (!contextMatches(session.context)) { cancel(); return; }
    const context = session.context;
    cancel();
    if (contextMatches(context)) onError(error, context);
  }

  function readableError(error) {
    if (error?.code?.startsWith?.('voice_')) return error;
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return voiceError('Permite o acesso ao microfone nas definições do navegador e tenta novamente. Também podes escrever.', 'voice_permission');
    }
    if (error?.name === 'NotFoundError') {
      return voiceError('Não foi encontrado um microfone. Liga um microfone ou escreve a mensagem.', 'voice_missing');
    }
    if (error?.name === 'NotSupportedError') {
      return voiceError('O formato de gravação não está disponível neste iPhone. Experimenta no Safari.', 'voice_unsupported_format');
    }
    if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
      return voiceError('Não foi possível usar o microfone. Fecha outras chamadas ou gravações e tenta novamente.', 'voice_unavailable');
    }
    return voiceError('Não foi possível iniciar a gravação. Tenta novamente ou escreve a mensagem.', 'voice_recording');
  }

  function makeRecorder(stream) {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const mimeType of types) {
      try {
        if (MediaRecorderClass.isTypeSupported?.(mimeType)) {
          return new MediaRecorderClass(stream, {mimeType, audioBitsPerSecond: 64_000});
        }
      } catch { /* A claimed format may still be unavailable on this device. */ }
    }
    return new MediaRecorderClass(stream);
  }

  async function recorded(session) {
    if (!owns(session) || session.finalizing) return;
    if (!contextMatches(session.context)) { cancel(); return; }
    session.finalizing = true;
    updateState('transcribing', session);
    // Keep navigation listeners while transcription is pending, but release the mic now.
    release(session, false);
    // Some browsers reset recorder.mimeType during stop; chunk types remain authoritative.
    const mimeType = session.chunks.find(chunk => chunk.type)?.type || session.mimeType || session.recorder.mimeType;
    const blob = new Blob(session.chunks, {type: mimeType});
    session.chunks.length = 0;
    if (blob.size < 128) {
      fail(session, voiceError('A gravação ficou vazia ou demasiado curta. Toca no microfone e volta a falar.', 'voice_empty'));
      return;
    }
    if (blob.size > maxBytes) {
      fail(session, voiceError('A gravação ficou demasiado longa. Experimenta uma mensagem mais curta.', 'voice_size'));
      return;
    }
    try {
      const result = await transcribe(blob, {context: session.context, signal: session.controller.signal});
      if (!current(session)) {
        if (owns(session)) cancel();
        return;
      }
      const text = typeof result === 'string' ? result.trim() : '';
      if (!text) {
        fail(session, voiceError('Não consegui perceber o que disseste. Tenta novamente, mais perto do microfone.', 'voice_no_speech'));
        return;
      }
      // A consumer can immediately submit the text and update its own busy state.
      if (finish(session)) onText(text, session.context);
    } catch (error) {
      if (!owns(session)) return;
      if (!contextMatches(session.context)) { cancel(); return; }
      const message = error?.message || 'Não foi possível transcrever a gravação. Verifica a ligação e tenta novamente.';
      fail(session, voiceError(message, 'voice_transcription'));
    }
  }

  function stop() {
    const session = active;
    if (!session || state !== 'recording') return;
    if (!contextMatches(session.context)) { cancel(); return; }
    clearInterval(session.interval);
    clearTimeout(session.deadline);
    updateState('transcribing', session);
    try {
      // iOS may drop the final AAC/MP4 chunk if tracks stop before onstop.
      session.stopTimer = setTimeout(() => {
        if (owns(session) && !session.finalizing) {
          fail(session, voiceError('A gravação não terminou no iPhone. Toca novamente em Gravar voz.', 'voice_stop_timeout'));
        }
      }, stopFinalizeTimeoutMs);
      session.recorder.stop();
      // Keep microphone tracks alive until onstop flushes the final chunk.
    } catch (error) {
      fail(session, readableError(error));
    }
  }

  async function start(context) {
    const session = {
      id: ++generation,
      context: Object.freeze({...context}),
      controller: new AbortController(),
      cancelled: false,
      finalizing: false,
      chunks: [],
      bytes: 0,
      removeListeners: [],
      startedAt: 0,
      stream: null,
      recorder: null,
    };
    active = session;
    if (!contextMatches(session.context)) { cancel(); return; }
    if (!getUserMedia || !MediaRecorderClass || typeof transcribe !== 'function') {
      fail(session, voiceError('Este navegador não permite gravar aqui. Abre no Safari ou Chrome, ou escreve a mensagem.', 'voice_unsupported'));
      return;
    }
    updateState('requesting', session);
    listen(session, globalThis, 'pagehide', () => { if (owns(session)) cancel(); });
    listen(session, globalThis.document, 'visibilitychange', () => {
      // iOS may briefly hide the page while presenting microphone permission.
      if (globalThis.document?.hidden && owns(session) && state !== 'requesting') {
        fail(session, voiceError('A gravação foi interrompida ao sair da aplicação. Toca em Gravar voz novamente.', 'voice_background'));
      }
    });
    try {
      const stream = await getUserMedia({audio: true});
      // A permission prompt can complete after navigation, cancellation or logout.
      if (!current(session)) {
        stopTracks(stream);
        if (owns(session)) cancel();
        return;
      }
      session.stream = stream;
      if (globalThis.document?.hidden) {
        fail(session, voiceError('A aplicação ficou em segundo plano. Reabre e toca em Gravar voz.', 'voice_background'));
        return;
      }
      const recorder = makeRecorder(stream);
      session.recorder = recorder;
      recorder.ondataavailable = event => {
        if (!owns(session) || !event.data?.size) return;
        session.bytes += event.data.size;
        if (session.bytes > maxBytes) {
          fail(session, voiceError('A gravação ficou demasiado longa. Experimenta uma mensagem mais curta.', 'voice_size'));
          return;
        }
        session.chunks.push(event.data);
      };
      recorder.onstop = () => { void recorded(session); };
      recorder.onerror = () => {
        fail(session, voiceError('A gravação foi interrompida. Toca no microfone para tentar novamente.', 'voice_interrupted'));
      };
      const interrupted = () => {
        if (owns(session) && state === 'recording') {
          fail(session, voiceError('A gravação foi interrompida. Toca no microfone para tentar novamente.', 'voice_interrupted'));
        }
      };
      for (const track of stream.getTracks()) {
        listen(session, track, 'ended', interrupted);
        // A transient iOS mute while negotiating its audio session must not
        // silently discard the entire recording.
      }
      recorder.start(1000);
      if (!current(session)) {
        if (owns(session)) cancel();
        return;
      }
      session.mimeType = recorder.mimeType;
      session.startedAt = Date.now();
      updateState('recording', session);
      session.interval = setInterval(() => {
        if (!current(session)) { if (owns(session)) cancel(); return; }
        updateState('recording', session);
      }, 1000);
      session.deadline = setTimeout(() => { if (owns(session)) stop(); }, maxDurationMs);
    } catch (error) {
      if (owns(session)) fail(session, readableError(error));
    }
  }

  return {
    toggle(context) {
      if (state === 'recording') { stop(); return Promise.resolve(); }
      if (state !== 'idle') return Promise.resolve();
      return start(context);
    },
    stop,
    cancel,
    get state() { return state; },
  };
}
