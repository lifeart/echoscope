const STORAGE_KEY = 'echoscope:onboardingDone';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

let overlayInitialized = false;

/** Wire up overlay dismiss behavior exactly once. */
function ensureOverlayWired(overlay: HTMLElement): void {
  if (overlayInitialized) return;
  overlayInitialized = true;

  const dismiss = () => {
    overlay.classList.add('hidden');
    localStorage.setItem(STORAGE_KEY, '1');
    if (savedFocus && typeof savedFocus.focus === 'function') {
      savedFocus.focus();
    }
  };

  // "Get Started" button
  el('onboardingDismiss')?.addEventListener('click', dismiss);

  // "Don't show again" link
  el('onboardingNeverShow')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    dismiss();
  });

  // Click outside the dialog box to dismiss
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) dismiss();
  });

  // Escape key + focus trap
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      dismiss();
      return;
    }

    if (ev.key === 'Tab') {
      const focusable = overlay.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey) {
        if (document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }
  });
}

let savedFocus: HTMLElement | null = null;

/** Show the onboarding overlay. */
function showOverlay(): void {
  const overlay = el('onboardingOverlay');
  if (!overlay) return;

  savedFocus = document.activeElement as HTMLElement | null;
  ensureOverlayWired(overlay);
  overlay.classList.remove('hidden');

  const dismissBtn = el('onboardingDismiss');
  if (dismissBtn) {
    requestAnimationFrame(() => dismissBtn.focus());
  }
}

/** Show onboarding overlay on first visit. No-op if already dismissed. */
export function initOnboarding(): void {
  // Wire up the Help (?) button so it always re-shows the overlay
  el('btnHelp')?.addEventListener('click', () => showOverlay());

  if (localStorage.getItem(STORAGE_KEY)) return;
  showOverlay();
}
