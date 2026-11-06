// The only channel between the site and the extension.
//
// The page sends its own session and profile deliberately; the extension reads nothing else
// from the page. The token stays scoped to that user, so the extension can only ever touch
// their rows.
//
// Announcing once on load is not enough: this runs at document_idle, which is usually before
// React has mounted and started listening, so the site would never learn the extension is
// there. It announces on load *and* answers whenever the page asks.

const announce = () => window.postMessage(
  { type: 'fursa:extension-ready', version: chrome.runtime.getManifest().version }, '*');

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data?.type === 'fursa:extension-hello') { announce(); return; }
  if (e.data?.type === 'fursa:sync') {
    chrome.runtime.sendMessage({ type: 'fursa:sync', session: e.data.session, profile: e.data.profile });
  }
});

announce();
