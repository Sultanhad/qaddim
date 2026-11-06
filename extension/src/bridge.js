// The only channel between the site and the extension.
//
// The page sends its own session and profile deliberately; the extension reads nothing else from
// the page. The token stays scoped to that user, so the extension can only ever touch their rows.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.type !== 'fursa:sync') return;
  chrome.runtime.sendMessage({ type: 'fursa:sync', session: e.data.session, profile: e.data.profile });
});

window.postMessage({ type: 'fursa:extension-ready', version: chrome.runtime.getManifest().version }, '*');
