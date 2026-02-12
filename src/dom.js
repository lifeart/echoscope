import { clamp } from './utils.js';

export function el(id) {
  return document.getElementById(id);
}

export function log(msg) {
  const logEl = el("log");
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

export function setStatus(msg) {
  el("status").textContent = "Status: " + msg;
}

export function getDirectionAxis() {
  const v = el("dirAxis")?.value || "horizontal";
  return (v === "vertical") ? "vertical" : "horizontal";
}

export function classifyDirection(angleDeg, axis) {
  if (!Number.isFinite(angleDeg)) return "\u2014";
  const deadZone = 7;
  if (Math.abs(angleDeg) <= deadZone) return "Center";
  if (axis === "vertical") return (angleDeg >= 0) ? "Top" : "Bottom";
  return (angleDeg >= 0) ? "Right" : "Left";
}

export function updateDirectionReadout(angleDeg, strength, gate) {
  const dirReadoutEl = el("dirReadout");
  if (!Number.isFinite(angleDeg) || !Number.isFinite(strength) || strength <= gate) {
    dirReadoutEl.textContent = "Direction: \u2014";
    return;
  }
  const axis = getDirectionAxis();
  const direction = classifyDirection(angleDeg, axis);
  const confidence = clamp((strength - gate) / Math.max(1e-6, 1 - gate), 0, 1);
  const axisTag = (axis === "vertical") ? "T/B" : "L/R";
  dirReadoutEl.textContent = `Direction: ${direction} (${axisTag}, ${(confidence * 100).toFixed(0)}%)`;
}
