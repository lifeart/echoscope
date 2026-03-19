/**
 * PWA update notifier.
 *
 * Uses the service worker lifecycle to detect when a new version is available
 * and shows a non-intrusive banner prompting the user to reload.
 */

function createUpdateBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.id = 'pwaBanner';
  banner.className = 'pwa-update-banner';
  banner.innerHTML =
    'A new version is available. ' +
    '<button id="pwaReload" type="button">Reload</button>' +
    '<button id="pwaDismiss" type="button" class="pwa-dismiss">\u00d7</button>';
  document.body.appendChild(banner);
  return banner;
}

function showUpdateBanner(registration: ServiceWorkerRegistration): void {
  const banner = createUpdateBanner();

  document.getElementById('pwaReload')?.addEventListener('click', () => {
    // Tell the waiting SW to activate immediately
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  });

  document.getElementById('pwaDismiss')?.addEventListener('click', () => {
    banner.remove();
  });
}

export function initPwaUpdateNotifier(): void {
  if (!('serviceWorker' in navigator)) return;

  // vite-plugin-pwa with registerType: 'autoUpdate' registers the SW
  // automatically. We listen for update events on any existing registration.
  navigator.serviceWorker.ready.then((registration) => {
    // New SW installed and waiting
    if (registration.waiting) {
      showUpdateBanner(registration);
      return;
    }

    // New SW installing — wait for it to become waiting
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content available, show reload prompt
          showUpdateBanner(registration);
        }
      });
    });
  });

  // When the new SW takes over, reload to get fresh assets
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
