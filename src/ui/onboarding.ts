const STORAGE_KEY = 'echoscope:onboardingDone';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Show onboarding overlay on first visit. No-op if already dismissed. */
export function initOnboarding(): void {
  if (localStorage.getItem(STORAGE_KEY)) return;

  const overlay = el('onboardingOverlay');
  if (!overlay) return;

  overlay.classList.remove('hidden');

  const dismiss = () => {
    overlay.classList.add('hidden');
    localStorage.setItem(STORAGE_KEY, '1');
  };

  // "Get Started" button
  el('onboardingDismiss')?.addEventListener('click', dismiss);

  // "Don't show again" link — same effect
  el('onboardingNeverShow')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    dismiss();
  });

  // Click outside the dialog box to dismiss
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) dismiss();
  });
}
