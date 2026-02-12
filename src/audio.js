import { state } from './state.js';
import { el, log, setStatus } from './dom.js';
import { clamp, sleep } from './utils.js';

export function resumeIfSuspended() {
  if (state.ac && state.ac.state !== "running") return state.ac.resume();
  return Promise.resolve();
}

export function allocRing(seconds = 2.2) {
  state.ringSize = Math.floor(state.sr * seconds);
  state.ring = new Float32Array(state.ringSize);
  state.ringWrite = 0;
}

export function pushSamples(samples) {
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    state.ring[state.ringWrite] = samples[i];
    state.ringWrite = (state.ringWrite + 1) % state.ringSize;
  }
}

export function readRingWindow(endIndexExclusive, length) {
  const out = new Float32Array(length);
  let idx = (endIndexExclusive - length) % state.ringSize;
  if (idx < 0) idx += state.ringSize;
  for (let i = 0; i < length; i++) {
    out[i] = state.ring[idx];
    idx = (idx + 1) % state.ringSize;
  }
  return out;
}

export function computeListenSamples(listenMs, refLength) {
  const listenMsSafe = Number.isFinite(listenMs) ? Math.max(0, listenMs) : 0;
  const byMs = Math.floor(state.sr * (listenMsSafe / 1000));
  const refLen = Number.isFinite(refLength) ? Math.max(0, refLength | 0) : 0;
  const refNeed = refLen + Math.floor(state.sr * 0.030);
  return Math.max(2048, byMs, refNeed);
}

export async function refreshDeviceInfo() {
  const deviceInfoEl = el("deviceInfo");
  const lines = [];
  lines.push(`Time: ${new Date().toISOString()}`);
  lines.push(`UserAgent: ${navigator.userAgent}`);
  if (navigator.userAgentData && navigator.userAgentData.platform) lines.push(`UAData.platform: ${navigator.userAgentData.platform}`);
  lines.push(`Platform: ${navigator.platform || "n/a"}`);
  lines.push(`Languages: ${(navigator.languages || []).join(", ") || "n/a"}`);
  lines.push(`SecureContext: ${window.isSecureContext}`);
  lines.push("");

  if (state.ac) {
    lines.push(`AudioContext.state: ${state.ac.state}`);
    lines.push(`AudioContext.sampleRate: ${state.ac.sampleRate} Hz`);
    if (typeof state.ac.baseLatency === "number") lines.push(`AudioContext.baseLatency: ${state.ac.baseLatency.toFixed(4)} s`);
    if (typeof state.ac.outputLatency === "number") lines.push(`AudioContext.outputLatency: ${state.ac.outputLatency.toFixed(4)} s`);
  } else {
    lines.push("AudioContext: not initialized");
  }

  lines.push("");
  lines.push("MediaDevices:");
  if (!navigator.mediaDevices) {
    lines.push("  mediaDevices: not available");
    deviceInfoEl.textContent = lines.join("\n");
    return;
  }

  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const groups = { audioinput: [], audiooutput: [], videoinput: [], other: [] };
    for (const d of devs) {
      const k = groups[d.kind] ? d.kind : "other";
      groups[k].push(d);
    }
    for (const kind of ["audioinput", "audiooutput", "videoinput", "other"]) {
      if (!groups[kind].length) continue;
      lines.push(`  ${kind}:`);
      for (const d of groups[kind]) {
        const label = d.label || "(label hidden until permission)";
        const id = d.deviceId ? (d.deviceId.length > 10 ? d.deviceId.slice(0, 10) + "\u2026" : d.deviceId) : "n/a";
        const gid = d.groupId ? (d.groupId.length > 10 ? d.groupId.slice(0, 10) + "\u2026" : d.groupId) : "n/a";
        lines.push(`    - label="${label}" id=${id} group=${gid}`);
      }
    }
  } catch (e) {
    lines.push("  enumerateDevices failed: " + (e?.message || e));
  }

  deviceInfoEl.textContent = lines.join("\n");
}

export async function initAudio(renderCalibInfo) {
  if (state.ac) {
    await resumeIfSuspended();
    log("[ok] audio resumed");
    await refreshDeviceInfo();
    return;
  }

  state.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  state.sr = state.ac.sampleRate;

  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
  });

  state.micSource = state.ac.createMediaStreamSource(state.micStream);
  allocRing(2.2);

  state.useWorklet = false;
  try {
    const workletCode = `
      class MicTapProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input[0] && input[0].length) this.port.postMessage(input[0]);
          return true;
        }
      }
      registerProcessor('mic-tap', MicTapProcessor);
    `;
    const blob = new Blob([workletCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await state.ac.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    state.micTapNode = new AudioWorkletNode(state.ac, "mic-tap");
    state.micTapNode.port.onmessage = (e) => {
      const a = e.data;
      const copy = new Float32Array(a.length);
      copy.set(a);
      pushSamples(copy);
    };
    state.micSource.connect(state.micTapNode);
    state.useWorklet = true;
  } catch (e) {
    const sp = state.ac.createScriptProcessor(1024, 1, 1);
    sp.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      pushSamples(copy);
    };
    state.micTapNode = sp;
    state.micSource.connect(sp);
    state.useWorklet = false;
  }

  await resumeIfSuspended();

  el("btnPing").disabled = false;
  el("btnScan").disabled = false;
  el("btnStop").disabled = false;
  el("btnCalibrate").disabled = false;
  el("btnRefreshDevices").disabled = false;

  log(`[ok] audio initialized: sr=${state.sr} Hz, capture=${state.useWorklet ? "AudioWorklet" : "ScriptProcessor"}, ring=${state.ringSize} samples`);
  setStatus("ready");
  await refreshDeviceInfo();
  renderCalibInfo();
}

// ---------- Stereo TX building ----------
export function buildStereoPingCustom(mono, gainL, gainR, delayL, delayR) {
  const buf = state.ac.createBuffer(1, mono.length, state.sr);
  buf.copyToChannel(mono, 0);

  const srcL = state.ac.createBufferSource();
  const srcR = state.ac.createBufferSource();
  srcL.buffer = buf;
  srcR.buffer = buf;

  const gL = state.ac.createGain(); gL.gain.value = gainL;
  const gR = state.ac.createGain(); gR.gain.value = gainR;

  const dL = state.ac.createDelay(0.12); dL.delayTime.value = delayL;
  const dR = state.ac.createDelay(0.12); dR.delayTime.value = delayR;

  const merger = state.ac.createChannelMerger(2);
  srcL.connect(gL).connect(dL).connect(merger, 0, 0);
  srcR.connect(gR).connect(dR).connect(merger, 0, 1);

  return { srcL, srcR, out: merger, pingSec: mono.length / state.sr, delayL, delayR };
}

export function buildSteeredStereoPing(mono, dtSeconds, gain) {
  const t0 = 0.012;
  let delayL = t0, delayR = t0;
  if (dtSeconds >= 0) delayR = t0 + dtSeconds;
  else delayL = t0 + (-dtSeconds);
  return buildStereoPingCustom(mono, gain, gain, delayL, delayR);
}

export function buildStereoPingCustomForOneSide(mono, which, gain, delaySec) {
  const gL = (which === "L") ? gain : 0.0;
  const gR = (which === "R") ? gain : 0.0;
  return buildStereoPingCustom(mono, gL, gR, delaySec, delaySec);
}

export async function pingAndCaptureOneSide(monoRef, which, gain, listenMs) {
  const delay = 0.012;
  const ping = buildStereoPingCustomForOneSide(monoRef, which, gain, delay);
  ping.out.connect(state.ac.destination);

  const tStart = state.ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = delay + ping.pingSec;
  await sleep((emitDelay + 0.040) * 1000);

  const end = state.ringWrite;
  const listenSamples = computeListenSamples(listenMs, monoRef.length);
  const micWin = readRingWindow(end, listenSamples);

  ping.out.disconnect();
  return { micWin, which, delay };
}

export async function pingAndCaptureSteered(monoRef, dt, gain, listenMs) {
  const ping = buildSteeredStereoPing(monoRef, dt, gain);
  ping.out.connect(state.ac.destination);

  const tStart = state.ac.currentTime + 0.03;
  ping.srcL.start(tStart);
  ping.srcR.start(tStart);

  const emitDelay = Math.max(ping.delayL, ping.delayR) + ping.pingSec;
  await sleep((emitDelay + 0.040) * 1000);

  const end = state.ringWrite;
  const listenSamples = computeListenSamples(listenMs, monoRef.length);
  const micWin = readRingWindow(end, listenSamples);

  ping.out.disconnect();
  return { micWin, delayL: ping.delayL, delayR: ping.delayR };
}
