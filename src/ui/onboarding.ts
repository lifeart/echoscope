const STORAGE_KEY = 'echoscope:onboardingDone';

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setupOverlayBehavior(overlay: HTMLElement, dismiss: () => void): void {
  // Click outside the dialog box to dismiss
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) dismiss();
  });

  // Escape key dismisses the dialog
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      dismiss();
      return;
    }

    // Focus trap: cycle Tab between interactive elements
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

/** Show the onboarding overlay and wire dismiss behavior. */
function showOverlay(): void {
  const overlay = el('onboardingOverlay');
  if (!overlay) return;

  // Remember previously focused element to restore on dismiss
  const previouslyFocused = document.activeElement as HTMLElement | null;

  overlay.classList.remove('hidden');

  const dismiss = () => {
    overlay.classList.add('hidden');
    localStorage.setItem(STORAGE_KEY, '1');
    // Return focus to previously focused element
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };

  // "Get Started" button
  const dismissBtn = el('onboardingDismiss');
  dismissBtn?.addEventListener('click', dismiss);

  // "Don't show again" link — same effect
  const neverShowLink = el('onboardingNeverShow');
  neverShowLink?.addEventListener('click', (ev) => {
    ev.preventDefault();
    dismiss();
  });

  setupOverlayBehavior(overlay, dismiss);

  // Move focus to the "Get Started" button when dialog opens
  if (dismissBtn) {
    requestAnimationFrame(() => {
      (dismissBtn as HTMLElement).focus();
    });
  }
}

/** Show onboarding overlay on first visit. No-op if already dismissed. */
export function initOnboarding(): void {
  // Wire up the Help (?) button so it always re-shows the overlay
  const helpBtn = el('btnHelp');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      showOverlay();
    });
  }

  if (localStorage.getItem(STORAGE_KEY)) return;

  showOverlay();
}
