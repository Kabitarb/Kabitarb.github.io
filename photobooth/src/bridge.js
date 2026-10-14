// iOS shell bridge contract (feature-detected).
export const isShell = () => /DalkomBoothiOS\//.test(navigator.userAgent);
export const shellVersion = () => (navigator.userAgent.match(/DalkomBoothiOS\/([\d.]+)/) || [])[1] || null;

const mh = () => window.webkit && window.webkit.messageHandlers;

export function haptic(kind = 'light') {
  try {
    if (mh() && mh().haptic) mh().haptic.postMessage(kind);
  } catch (e) { /* fire and forget */ }
  try { navigator.vibrate && navigator.vibrate(10); } catch (e) {}
}

// resolves 'ok' or rejects with error string
export function saveToPhotos({ kind, mime, name, b64 }) {
  return mh().saveToPhotos.postMessage({ kind, mime, name, b64 });
}
export function hasSaveToPhotos() {
  try { return !!(mh() && mh().saveToPhotos); } catch (e) { return false; }
}

// resolves array of {name,mime,b64}; [] if cancelled
export function pickLive(limit = 8) {
  return mh().pickLive.postMessage({ limit });
}
export function hasPickLive() {
  try { return !!(mh() && mh().pickLive); } catch (e) { return false; }
}

export function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
