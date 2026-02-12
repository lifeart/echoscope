import { store } from '../core/store.js';

export async function refreshDeviceInfo(): Promise<void> {
  const deviceInfoEl = document.getElementById('deviceInfo');
  if (!deviceInfoEl) return;

  const lines: string[] = [];
  lines.push(`Time: ${new Date().toISOString()}`);
  lines.push(`UserAgent: ${navigator.userAgent}`);
  if ((navigator as any).userAgentData?.platform) lines.push(`UAData.platform: ${(navigator as any).userAgentData.platform}`);
  lines.push(`Platform: ${navigator.platform || 'n/a'}`);
  lines.push(`Languages: ${(navigator.languages || []).join(', ') || 'n/a'}`);
  lines.push(`SecureContext: ${window.isSecureContext}`);
  lines.push('');

  const ctx = store.get().audio.context;
  if (ctx) {
    lines.push(`AudioContext.state: ${ctx.state}`);
    lines.push(`AudioContext.sampleRate: ${ctx.sampleRate} Hz`);
    if (typeof ctx.baseLatency === 'number') lines.push(`AudioContext.baseLatency: ${ctx.baseLatency.toFixed(4)} s`);
    if (typeof (ctx as any).outputLatency === 'number') lines.push(`AudioContext.outputLatency: ${(ctx as any).outputLatency.toFixed(4)} s`);
  } else {
    lines.push('AudioContext: not initialized');
  }

  lines.push('');
  lines.push('MediaDevices:');
  if (!navigator.mediaDevices) {
    lines.push('  mediaDevices: not available');
    deviceInfoEl.textContent = lines.join('\n');
    return;
  }

  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const groups: Record<string, MediaDeviceInfo[]> = { audioinput: [], audiooutput: [], videoinput: [], other: [] };
    for (const d of devs) {
      const k = groups[d.kind] ? d.kind : 'other';
      groups[k].push(d);
    }
    for (const kind of ['audioinput', 'audiooutput', 'videoinput', 'other']) {
      if (!groups[kind].length) continue;
      lines.push(`  ${kind}:`);
      for (const d of groups[kind]) {
        const label = d.label || '(label hidden until permission)';
        const id = d.deviceId ? (d.deviceId.length > 10 ? d.deviceId.slice(0, 10) + '\u2026' : d.deviceId) : 'n/a';
        const gid = d.groupId ? (d.groupId.length > 10 ? d.groupId.slice(0, 10) + '\u2026' : d.groupId) : 'n/a';
        lines.push(`    - label="${label}" id=${id} group=${gid}`);
      }
    }
  } catch (e: any) {
    lines.push('  enumerateDevices failed: ' + (e?.message || e));
  }

  deviceInfoEl.textContent = lines.join('\n');
}
