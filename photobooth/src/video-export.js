// Live strip MP4/WebM export.
// Primary: WebCodecs VideoEncoder + vendored mp4-muxer, deterministic seek-per-frame.
// Fallback: canvas.captureStream(30) + MediaRecorder realtime.

import { render, ensureFonts } from './render.js';
import { getLayout, layoutSize } from './layouts.js';
import { getTheme } from './themes.js';
import { seekVideo } from './media.js';
import * as Mp4Muxer from '../vendor/mp4-muxer.min.mjs';

const FPS = 30;

function even(n) { return Math.floor(n / 2) * 2; }

// length = longest clip, looped 2x (>= 4s floor for a sane clip)
export function liveDuration(project, layout) {
  let longest = 0;
  layout.cells.forEach((_, i) => {
    const c = project.cells[i];
    if (c && c.media && c.media.type === 'video') longest = Math.max(longest, c.media.dur || 3);
  });
  return Math.max(2, Math.min(3, longest)) * 2;
}

async function seekCellVideos(project, t) {
  const jobs = [];
  for (const cell of project.cells) {
    const m = cell && cell.media;
    if (!m || m.type !== 'video') continue;
    const v = project.getMediaSource(m, t);
    if (!v) continue;
    const tt = m.start + ((t % Math.max(0.05, m.dur || 3)));
    jobs.push(seekVideo(v, Math.min(tt, (m.srcDur || v.duration || tt) - 0.05)));
  }
  await Promise.all(jobs);
}

async function exportWebCodecs(project, canvas, ctx, seconds, onProgress) {
  const { Muxer, ArrayBufferTarget } = Mp4Muxer;
  const w = even(canvas.width), h = even(canvas.height);
  canvas.width = w; canvas.height = h;
  const codecs = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
  let config = null;
  for (const codec of codecs) {
    const c = { codec, width: w, height: h, bitrate: 8_000_000, framerate: FPS };
    try {
      const sup = await VideoEncoder.isConfigSupported(c);
      if (sup.supported) { config = c; break; }
    } catch (e) {}
  }
  if (!config) throw new Error('no supported H.264 config');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' });
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  enc.configure(config);
  const total = Math.round(seconds * FPS);
  const scale = w / layoutSize(getLayout(project.layoutId)).w;
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    await seekCellVideos(project, t);
    render(ctx, project, { scale, time: t });
    const frame = new VideoFrame(canvas, { timestamp: f * 1e6 / FPS, duration: 1e6 / FPS });
    enc.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    if (f % 10 === 0) { onProgress(f / total); await new Promise(r => setTimeout(r)); }
  }
  await enc.flush();
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

async function exportMediaRecorder(project, canvas, ctx, seconds, onProgress) {
  const scale = even(canvas.width) / layoutSize(getLayout(project.layoutId)).w;
  canvas.width = even(canvas.width); canvas.height = even(canvas.height);
  const stream = canvas.captureStream(FPS);
  const mimes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start(250);
  const total = Math.round(seconds * FPS);
  const t0 = performance.now();
  for (let f = 0; f < total; f++) {
    const t = (performance.now() - t0) / 1000;
    await seekCellVideos(project, t);
    render(ctx, project, { scale, time: t });
    onProgress(f / total);
    await new Promise(r => requestAnimationFrame(r));
    if (t > seconds + 0.5) break;
  }
  rec.stop(); await done;
  const type = mime.split(';')[0] || 'video/webm';
  return new Blob(chunks, { type });
}

export async function exportLive(project, onProgress = () => {}) {
  const layout = getLayout(project.layoutId);
  const size = layoutSize(layout);
  const canvas = document.createElement('canvas');
  canvas.width = even(size.w); canvas.height = even(size.h); // 300dpi
  const ctx = canvas.getContext('2d');
  await ensureFonts(project, getTheme(project.themeId));
  // warm up video elements
  for (const cell of project.cells) {
    if (cell && cell.media && cell.media.type === 'video') {
      const v = project.getMediaSource(cell.media, 0);
      if (v) await seekVideo(v, cell.media.start || 0);
    }
  }
  const seconds = liveDuration(project, layout);
  try {
    if (typeof VideoEncoder === 'undefined') throw new Error('no WebCodecs');
    const blob = await exportWebCodecs(project, canvas, ctx, seconds, onProgress);
    return { blob, ext: 'mp4', seconds };
  } catch (e) {
    console.warn('WebCodecs export failed, using MediaRecorder:', e && e.message);
    onProgress(0);
    const blob = await exportMediaRecorder(project, canvas, ctx, seconds, onProgress);
    return { blob, ext: blob.type.includes('mp4') ? 'mp4' : 'webm', seconds };
  }
}
