import { peerManager } from '../network/peer-manager.js';
import { copyToClipboard } from '../network/signaling.js';
import { setupCaptureResponseHandler } from '../network/capture-collector.js';
import { setupRemoteCaptureHandler } from '../network/remote-capture-handler.js';
import { bus } from '../core/event-bus.js';
import { log } from './readouts.js';
import { compressSignal, decompressSignal } from '../network/signal-compress.js';
import { buildOfferUrl, buildAnswerUrl } from './url-params.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

type QrTarget = 'host-offer' | 'device-answer';

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

let currentPeerId: string | null = null;
let flowState: 'idle' | 'offer-created' | 'waiting-answer' | 'waiting-offer' | 'answer-created' | 'connected' = 'idle';
let statusInterval: ReturnType<typeof setInterval> | null = null;
let activeScanner: { stop: () => void } | null = null;

export function setupPeerUI(): void {
  // Wire capture handlers
  setupCaptureResponseHandler();
  setupRemoteCaptureHandler();

  el('btnPeerCreateOffer')?.addEventListener('click', handleCreateOffer);
  el('btnPeerAcceptOffer')?.addEventListener('click', handleAcceptOffer);
  el('btnPeerDisconnect')?.addEventListener('click', handleDisconnect);
  el('btnPeerCopySignal')?.addEventListener('click', handleCopySignal);
  el('btnPeerApplySignal')?.addEventListener('click', handleApplySignal);
  el('btnPeerScanQr')?.addEventListener('click', handleStartScanAnswer);
  el('btnPeerStopScan')?.addEventListener('click', handleStopScan);

  // Listen for peer lifecycle events to update UI (especially for responder flow)
  bus.on('peer:connected', () => {
    if (flowState === 'answer-created' || flowState === 'offer-created' || flowState === 'waiting-answer') {
      flowState = 'connected';
      hideSignalBox();
      hideQrBoxes();
      startStatusPolling();
      syncPeerButtons();
      log('[peer] Connected!');
    }
  });

  bus.on('peer:disconnected', () => {
    if (flowState !== 'idle') {
      resetFlow();
      log('[peer] Peer disconnected');
    }
  });
}

export function syncPeerButtons(): void {
  const createBtn = el('btnPeerCreateOffer') as HTMLButtonElement | null;
  const acceptBtn = el('btnPeerAcceptOffer') as HTMLButtonElement | null;
  const disconnectBtn = el('btnPeerDisconnect') as HTMLButtonElement | null;

  if (createBtn) createBtn.disabled = flowState !== 'idle';
  if (acceptBtn) acceptBtn.disabled = flowState !== 'idle';
  if (disconnectBtn) disconnectBtn.disabled = flowState === 'idle';
}

function getQrElements(target: QrTarget): {
  qrBox: HTMLElement | null;
  qrLabel: HTMLElement | null;
  qrCanvas: HTMLCanvasElement | null;
} {
  if (target === 'host-offer') {
    return {
      qrBox: el('peerHostQrBox'),
      qrLabel: el('peerHostQrLabel'),
      qrCanvas: el('peerHostQrCanvas') as HTMLCanvasElement | null,
    };
  }
  return {
    qrBox: el('peerDeviceQrBox'),
    qrLabel: el('peerDeviceQrLabel'),
    qrCanvas: el('peerDeviceQrCanvas') as HTMLCanvasElement | null,
  };
}

function showQrLabel(target: QrTarget, text: string): void {
  const { qrLabel, qrBox } = getQrElements(target);
  if (qrLabel) qrLabel.textContent = text;
  if (qrBox) qrBox.classList.remove('hidden');
}

function hideQrLabel(target: QrTarget): void {
  const { qrBox } = getQrElements(target);
  if (qrBox) qrBox.classList.add('hidden');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function renderQrToTarget(target: QrTarget, data: string, successLabel: string): Promise<boolean> {
  const { qrCanvas } = getQrElements(target);
  if (!qrCanvas) {
    showQrLabel(target, 'QR unavailable. Use Copy/Apply below.');
    return false;
  }

  const { renderQrCode } = await import('./qr-code.js');
  await withTimeout(renderQrCode(qrCanvas, data), 12000, 'QR generation timeout');
  showQrLabel(target, successLabel);
  return true;
}

async function handleCreateOffer(): Promise<void> {
  const createBtn = el('btnPeerCreateOffer') as HTMLButtonElement | null;
  let debugSignalLen = 0;
  let debugParamLen = 0;
  let debugUrlLen = 0;
  try {
    // Show loading indicator
    if (createBtn) createBtn.textContent = 'Creating offer\u2026';
    hideQrLabel('device-answer');
    showQrLabel('host-offer', 'Generating offer\u2026');
    syncPeerButtons();

    const { peerId, offerText } = await peerManager.createOffer();
    currentPeerId = peerId;
    flowState = 'offer-created';

    showSignalBox('Offer (copy and send to other device):', offerText, false);
    log('[peer] Offer created. Copy it and send to the other device, then paste their answer.');
    syncPeerButtons();

    // Generate QR code with compressed offer payload
    try {
      showQrLabel('host-offer', 'Generating QR\u2026');
      debugSignalLen = offerText.length;
      const offerParam = await withTimeout(compressSignal(offerText), 12000, 'Signal compression timeout');
      debugParamLen = offerParam.length;
      const url = buildOfferUrl(offerParam);
      debugUrlLen = url.length;
      await renderQrToTarget('host-offer', url, 'Scan this QR from your phone');
      // Show scan button for scanning answer back
      const scanBox = el('peerScanBox');
      if (scanBox) scanBox.classList.remove('hidden');
    } catch (qrErr: any) {
      const reason = formatError(qrErr);
      showQrLabel('host-offer', `QR generation failed: ${reason}. Use Copy/Apply below.`);
      log(`[peer:err] QR offer failed: ${reason} | signalLen=${debugSignalLen}, paramLen=${debugParamLen}, urlLen=${debugUrlLen}`);
    }
  } catch (e: any) {
    log('[peer:err] Create offer failed: ' + (e?.message || e));
    hideQrLabel('host-offer');
  } finally {
    if (createBtn) createBtn.textContent = 'Create Offer';
  }
}

async function handleAcceptOffer(): Promise<void> {
  flowState = 'waiting-offer';
  showSignalBox('Paste offer from other device:', '', true);
  log('[peer] Paste the offer from the other device, then click Apply.');
  syncPeerButtons();
}

function handleDisconnect(): void {
  if (currentPeerId) {
    peerManager.disconnect(currentPeerId);
    log('[peer] Disconnected from ' + currentPeerId);
  } else {
    peerManager.disconnectAll();
    log('[peer] Disconnected all peers');
  }
  resetFlow();
}

async function handleCopySignal(): Promise<void> {
  const textarea = el('peerSignalText') as HTMLTextAreaElement | null;
  if (!textarea) return;

  const ok = await copyToClipboard(textarea.value);
  if (ok) {
    log('[peer] Signal copied to clipboard');
  } else {
    log('[peer] Copy failed — select text manually');
    textarea.select();
  }

  // After copying offer, show paste area for answer
  if (flowState === 'offer-created') {
    flowState = 'waiting-answer';
    showSignalBox('Paste answer from other device:', '', true);
  }
}

async function handleApplySignal(): Promise<void> {
  const textarea = el('peerSignalText') as HTMLTextAreaElement | null;
  if (!textarea || !textarea.value.trim()) return;

  try {
    if (flowState === 'waiting-answer' && currentPeerId) {
      // Initiator: applying the answer
      await peerManager.acceptAnswer(currentPeerId, textarea.value.trim());
      log('[peer] Answer applied. Connecting...');
      flowState = 'connected';
      hideSignalBox();
      startStatusPolling();
      syncPeerButtons();
    } else if (flowState === 'waiting-offer') {
      // Responder: applying the offer, getting an answer
      const { peerId, answerText } = await peerManager.acceptOffer(textarea.value.trim());
      currentPeerId = peerId;
      flowState = 'answer-created';
      showSignalBox('Answer (copy and send back):', answerText, false);
      log('[peer] Answer generated. Copy it and send back to the other device.');
      syncPeerButtons();
    }
  } catch (e: any) {
    log('[peer:err] Apply signal failed: ' + (e?.message || e));
  }
}

function showSignalBox(label: string, value: string, editable: boolean): void {
  const box = el('peerSignalBox');
  const labelEl = el('peerSignalLabel');
  const textarea = el('peerSignalText') as HTMLTextAreaElement | null;
  const applyBtn = el('btnPeerApplySignal');

  if (box) box.style.display = 'block';
  if (labelEl) labelEl.textContent = label;
  if (textarea) {
    textarea.value = value;
    textarea.readOnly = !editable;
    if (editable) textarea.focus();
  }
  if (applyBtn) applyBtn.style.display = editable ? 'inline-block' : 'none';
}

function hideSignalBox(): void {
  const box = el('peerSignalBox');
  if (box) box.style.display = 'none';
}

function startStatusPolling(): void {
  if (statusInterval) clearInterval(statusInterval);

  const statusBox = el('peerStatusBox');
  if (statusBox) statusBox.style.display = 'block';

  statusInterval = setInterval(renderPeerStatus, 2000);
  renderPeerStatus();
}

function renderPeerStatus(): void {
  const statusEl = el('peerStatus');
  if (!statusEl) return;

  const peers = peerManager.getTransport().getPeers();
  if (peers.size === 0) {
    statusEl.textContent = 'No peers connected';
    return;
  }

  const lines: string[] = [];
  for (const [id, peer] of peers) {
    const state = peerManager.getPeerState(id);
    const offset = peerManager.getPeerClockOffset(id);
    const hbAgo = ((Date.now() - peer.lastHeartbeat) / 1000).toFixed(1);
    lines.push(`${id}: ${state} | offset=${(offset * 1000).toFixed(2)}ms | hb=${hbAgo}s ago`);
  }
  statusEl.textContent = lines.join('\n');
}

async function handleStartScanAnswer(): Promise<void> {
  const video = el('peerScanVideo') as HTMLVideoElement | null;
  const scanBtn = el('btnPeerScanQr');
  const stopBtn = el('btnPeerStopScan');
  if (!video) return;

  if (scanBtn) scanBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');

  const { startQrScanner } = await import('./qr-code.js');
  activeScanner = startQrScanner(video, async (data: string) => {
    handleStopScan();
    try {
      // Extract answer param from scanned URL
      const url = new URL(data);
      const answerParam = url.searchParams.get('a') ?? url.searchParams.get('answer');
      if (!answerParam) {
        log('[peer:err] Scanned QR does not contain an answer');
        return;
      }
      const answerText = await withTimeout(decompressSignal(answerParam), 12000, 'Signal decompression timeout');
      if (currentPeerId) {
        await peerManager.acceptAnswer(currentPeerId, answerText);
        log('[peer] Answer scanned and applied. Connecting...');
        flowState = 'connected';
        hideSignalBox();
        hideQrBoxes();
        startStatusPolling();
        syncPeerButtons();
      }
    } catch (e: any) {
      log('[peer:err] Failed to process scanned QR: ' + (e?.message || e));
    }
  });
}

function handleStopScan(): void {
  if (activeScanner) {
    activeScanner.stop();
    activeScanner = null;
  }
  const scanBtn = el('btnPeerScanQr');
  const stopBtn = el('btnPeerStopScan');
  if (scanBtn) scanBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
}

function hideQrBoxes(): void {
  const hostQrBox = el('peerHostQrBox');
  const deviceQrBox = el('peerDeviceQrBox');
  const scanBox = el('peerScanBox');
  if (hostQrBox) hostQrBox.classList.add('hidden');
  if (deviceQrBox) deviceQrBox.classList.add('hidden');
  if (scanBox) scanBox.classList.add('hidden');
  handleStopScan();
}

/** Called from app.ts when URL has ?offer= param (phone scanned desktop QR) */
export async function handleUrlOffer(offerParam: string): Promise<void> {
  let debugAnswerSignalLen = 0;
  let debugAnswerParamLen = 0;
  let debugAnswerUrlLen = 0;
  try {
    // Show immediate feedback while processing
    hideQrLabel('host-offer');
    showQrLabel('device-answer', 'Connecting\u2026');

    const offerText = await withTimeout(decompressSignal(offerParam), 12000, 'Signal decompression timeout');
    const { peerId, answerText } = await peerManager.acceptOffer(offerText);
    currentPeerId = peerId;
    flowState = 'answer-created';

    // Show answer as QR for desktop to scan
    debugAnswerSignalLen = answerText.length;
    const answerParam = await withTimeout(compressSignal(answerText), 12000, 'Signal compression timeout');
    debugAnswerParamLen = answerParam.length;
    const answerUrl = buildAnswerUrl(answerParam);
    debugAnswerUrlLen = answerUrl.length;
    await renderQrToTarget('device-answer', answerUrl, 'Show this QR to the other device');

    // Also show text fallback in the details section
    showSignalBox('Answer (copy and send back):', answerText, false);
    log('[peer] Offer accepted via URL. Show the answer QR to the other device.');
    syncPeerButtons();
  } catch (e: any) {
    hideQrLabel('device-answer');
    log(`[peer:err] URL offer failed: ${formatError(e)} | answerSignalLen=${debugAnswerSignalLen}, answerParamLen=${debugAnswerParamLen}, answerUrlLen=${debugAnswerUrlLen}`);
  }
}

/** Called from app.ts when URL has ?answer= param */
export async function handleUrlAnswer(answerParam: string): Promise<void> {
  try {
    const answerText = await withTimeout(decompressSignal(answerParam), 12000, 'Signal decompression timeout');
    if (currentPeerId) {
      await peerManager.acceptAnswer(currentPeerId, answerText);
      log('[peer] Answer applied via URL. Connecting...');
      flowState = 'connected';
      hideSignalBox();
      hideQrBoxes();
      startStatusPolling();
      syncPeerButtons();
    } else {
      log('[peer:err] No active offer to apply answer to');
    }
  } catch (e: any) {
    log('[peer:err] URL answer failed: ' + (e?.message || e));
  }
}

function resetFlow(): void {
  currentPeerId = null;
  flowState = 'idle';
  hideSignalBox();
  hideQrBoxes();
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  const statusBox = el('peerStatusBox');
  if (statusBox) statusBox.style.display = 'none';
  syncPeerButtons();
}
