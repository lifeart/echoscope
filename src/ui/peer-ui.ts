import { peerManager } from '../network/peer-manager.js';
import { copyToClipboard } from '../network/signaling.js';
import { setupCaptureResponseHandler } from '../network/capture-collector.js';
import { setupRemoteCaptureHandler } from '../network/remote-capture-handler.js';
import { bus } from '../core/event-bus.js';
import { log } from './readouts.js';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

let currentPeerId: string | null = null;
let flowState: 'idle' | 'offer-created' | 'waiting-answer' | 'waiting-offer' | 'answer-created' | 'connected' = 'idle';
let statusInterval: ReturnType<typeof setInterval> | null = null;

export function setupPeerUI(): void {
  // Wire capture handlers
  setupCaptureResponseHandler();
  setupRemoteCaptureHandler();

  el('btnPeerCreateOffer')?.addEventListener('click', handleCreateOffer);
  el('btnPeerAcceptOffer')?.addEventListener('click', handleAcceptOffer);
  el('btnPeerDisconnect')?.addEventListener('click', handleDisconnect);
  el('btnPeerCopySignal')?.addEventListener('click', handleCopySignal);
  el('btnPeerApplySignal')?.addEventListener('click', handleApplySignal);

  // Listen for peer lifecycle events to update UI (especially for responder flow)
  bus.on('peer:connected', () => {
    if (flowState === 'answer-created' || flowState === 'offer-created' || flowState === 'waiting-answer') {
      flowState = 'connected';
      hideSignalBox();
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

async function handleCreateOffer(): Promise<void> {
  try {
    const { peerId, offerText } = await peerManager.createOffer();
    currentPeerId = peerId;
    flowState = 'offer-created';

    showSignalBox('Offer (copy and send to other device):', offerText, false);
    log('[peer] Offer created. Copy it and send to the other device, then paste their answer.');
    syncPeerButtons();
  } catch (e: any) {
    log('[peer:err] Create offer failed: ' + (e?.message || e));
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

function resetFlow(): void {
  currentPeerId = null;
  flowState = 'idle';
  hideSignalBox();
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  const statusBox = el('peerStatusBox');
  if (statusBox) statusBox.style.display = 'none';
  syncPeerButtons();
}
