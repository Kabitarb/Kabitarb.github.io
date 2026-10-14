// Media loading: File/Blob -> media object {type:'image'|'video', blob, start, dur, w, h}
// plus runtime sources (ImageBitmap / HTMLVideoElement) on project runtime map.

export async function fileToMedia(file) {
  const blob = file instanceof Blob ? file : file;
  const type = blob.type.startsWith('video') ? 'video' : 'image';
  if (type === 'image') {
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (bmp) return { type, blob, start: 0, dur: 0, w: bmp.width, h: bmp.height };
    // fallback decode
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    return { type, blob, start: 0, dur: 0, w: img.naturalWidth, h: img.naturalHeight };
  }
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
  return { type, blob, start: 0, dur: Math.min(3, v.duration || 3), srcDur: v.duration || 0, w: v.videoWidth, h: v.videoHeight };
}

// Grab a still frame at time t from a video blob -> image media
export async function videoFrameToMedia(media) {
  const url = URL.createObjectURL(media.blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
  await seekVideo(v, media.start || 0);
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  URL.revokeObjectURL(url);
  return { type: 'image', blob, start: 0, dur: 0, w: v.videoWidth, h: v.videoHeight };
}

export function seekVideo(v, t) {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return res();
    const to = setTimeout(res, 2000);
    v.onseeked = () => { clearTimeout(to); res(); };
    v.currentTime = t;
  });
}

// Runtime media sources — kept outside serializable state
export function attachRuntime(project) {
  project._src = project._src || new Map();
  project.getMediaSource = (m, time) => {
    if (!m) return null;
    let r = project._src.get(m);
    if (!r) {
      const url = URL.createObjectURL(m.blob);
      if (m.type === 'image') {
        const img = new Image(); img.src = url;
        r = { img, ready: false };
        img.onload = () => { r.ready = true; project._dirty = true; };
      } else {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        r = { video: v, ready: false };
        v.onloadeddata = () => { r.ready = true; project._dirty = true; };
      }
      project._src.set(m, r);
    }
    if (m.type === 'image') return r.img && r.ready ? r.img : (r.img || null);
    return r.video;
  };
  return project;
}
