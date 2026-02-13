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

function showQrLabel(text: string): void {
  const qrLabel = el('peerQrLabel');
  const qrBox = el('peerQrBox');
  if (qrLabel) qrLabel.textContent = text;
  if (qrBox) qrBox.classList.remove('hidden');
}

function hideQrLabel(): void {
  const qrBox = el('peerQrBox');
  if (qrBox) qrBox.classList.add('hidden');
}

async function handleCreateOffer(): Promise<void> {
  const createBtn = el('btnPeerCreateOffer') as HTMLButtonElement | null;
  try {
    // Show loading indicator
    if (createBtn) createBtn.textContent = 'Creating offer\u2026';
    showQrLabel('Generating offer\u2026');
    syncPeerButtons();

    const { peerId, offerText } = await peerManager.createOffer();
    currentPeerId = peerId;
    flowState = 'offer-created';

    showSignalBox('Offer (copy and send to other device):', offerText, false);
    log('[peer] Offer created. Copy it and send to the other device, then paste their answer.');
    syncPeerButtons();

    // Generate QR code with compressed offer URL
    try {
      showQrLabel('Generating QR\u2026');
      const compressed = await compressSignal(offerText);
      const url = buildOfferUrl(compressed);
      const qrCanvas = el('peerQrCanvas') as HTMLCanvasElement | null;
      if (qrCanvas) {
        const { renderQrCode } = await import('./qr-code.js');
        await renderQrCode(qrCanvas, url);
        showQrLabel('Scan this QR from your phone');
      }
      // Show scan button for scanning answer back
      const scanBox = el('peerScanBox');
      if (scanBox) scanBox.classList.remove('hidden');
    } catch (qrErr: any) {
      hideQrLabel();
      log('[peer] QR generation failed (manual copy still works): ' + (qrErr?.message || qrErr));
    }
  } catch (e: any) {
    log('[peer:err] Create offer failed: ' + (e?.message || e));
    hideQrLabel();
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
      const answerParam = url.searchParams.get('answer');
      if (!answerParam) {
        log('[peer:err] Scanned QR does not contain an answer');
        return;
      }
      const answerText = await decompressSignal(answerParam);
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
  const qrBox = el('peerQrBox');
  const scanBox = el('peerScanBox');
  if (qrBox) qrBox.classList.add('hidden');
  if (scanBox) scanBox.classList.add('hidden');
  handleStopScan();
}

/** Called from app.ts when URL has ?offer= param (phone scanned desktop QR) */
export async function handleUrlOffer(offerParam: string): Promise<void> {
  try {
    // Show immediate feedback while processing
    showQrLabel('Connecting\u2026');

    const offerText = await decompressSignal(offerParam);
    const { peerId, answerText } = await peerManager.acceptOffer(offerText);
    currentPeerId = peerId;
    flowState = 'answer-created';

    // Show answer as QR for desktop to scan
    const compressed = await compressSignal(answerText);
    const answerUrl = buildAnswerUrl(compressed);
    const qrCanvas = el('peerQrCanvas') as HTMLCanvasElement | null;
    if (qrCanvas) {
      const { renderQrCode } = await import('./qr-code.js');
      await renderQrCode(qrCanvas, answerUrl);
      showQrLabel('Show this QR to the other device');
    }

    // Also show text fallback in the details section
    showSignalBox('Answer (copy and send back):', answerText, false);
    log('[peer] Offer accepted via URL. Show the answer QR to the other device.');
    syncPeerButtons();

    // Open diagnostics + peer section so text fallback is accessible
    const peerSection = el('peerSection') as HTMLDetailsElement | null;
    const diagnostics = el('diagnostics') as HTMLDetailsElement | null;
    if (diagnostics) diagnostics.open = true;
    if (peerSection) peerSection.open = true;
  } catch (e: any) {
    hideQrLabel();
    log('[peer:err] URL offer failed: ' + (e?.message || e));
  }
}

/** Called from app.ts when URL has ?answer= param */
export async function handleUrlAnswer(answerParam: string): Promise<void> {
  try {
    const answerText = await decompressSignal(answerParam);
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
