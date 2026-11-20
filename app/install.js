/**
 * Connect installation and offline readiness to the app shell.
 */
export function setupInstall() {
  const install = document.getElementById('install');
  const help = document.getElementById('help-dialog');
  const offline = document.getElementById('offline-status');
  const connection = document.getElementById('connection');
  let deferredPrompt;
  document.getElementById('help').addEventListener('click', () => {
    help.showModal();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    install.hidden = false;
  });
  install.addEventListener('click', async () => {
    if (!deferredPrompt) {
      return;
    }
    install.hidden = true;
    await deferredPrompt.prompt();
    deferredPrompt = undefined;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    install.hidden = true;
  });
  const updateConnection = () => {
    connection.textContent = navigator.onLine
      ? 'Online' : 'Offline · Local files available';
  };
  updateConnection();
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  if (!('serviceWorker' in navigator)) {
    offline.textContent = 'Offline access is unavailable in this browser';
    return;
  }
  const registered = navigator.serviceWorker.register('./service-worker.js');
  registered.then(async (registration) => {
    const watchInstallation = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !registration.active) {
          offline.textContent = 'Offline setup failed · Reload to retry';
        }
      });
    };
    watchInstallation();
    registration.addEventListener('updatefound', watchInstallation);
    await navigator.serviceWorker.ready;
    offline.textContent = 'Available offline';
    const reportUpdate = () => {
      if (registration.waiting) {
        offline.textContent = 'Update ready · Close all app windows to apply';
      }
    };
    reportUpdate();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', reportUpdate);
    });
  }).catch(() => {
    offline.textContent =
      'Offline setup failed · Reconnect and reload to retry';
  });
}
