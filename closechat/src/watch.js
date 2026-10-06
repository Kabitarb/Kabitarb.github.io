// "Watch together": everyone in the chat loads the same reel/short at the same
// time. Players are the platforms' own embeds (we cannot proxy or download
// them), so true frame-sync is not possible; we sync *which* clip is open.
export function parseMedia(url) {
  let u; try { u = new URL(String(url).trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let m;
  if (host === 'instagram.com' && (m = u.pathname.match(/^\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/))) {
    return { kind: 'instagram', id: m[2], url: `https://www.instagram.com/${m[1] === 'p' ? 'p' : 'reel'}/${m[2]}/`, embed: `https://www.instagram.com/${m[1] === 'p' ? 'p' : 'reel'}/${m[2]}/embed/` };
  }
  if ((host === 'youtube.com' || host === 'youtube-nocookie.com') && (m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/))) {
    return { kind: 'youtube', id: m[1], url: `https://www.youtube.com/shorts/${m[1]}`, embed: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&playsinline=1&rel=0` };
  }
  if (host === 'youtube.com' && u.searchParams.get('v')) {
    const id = u.searchParams.get('v');
    return { kind: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0` };
  }
  if (host === 'youtu.be' && (m = u.pathname.match(/^\/([A-Za-z0-9_-]{6,})/))) {
    return { kind: 'youtube', id: m[1], url: `https://youtu.be/${m[1]}`, embed: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&playsinline=1&rel=0` };
  }
  if (host === 'tiktok.com' && (m = u.pathname.match(/\/video\/(\d+)/))) {
    return { kind: 'tiktok', id: m[1], url: u.href, embed: `https://www.tiktok.com/embed/v2/${m[1]}` };
  }
  return null;
}
export const MEDIA_RE = /https?:\/\/(?:www\.|m\.)?(?:instagram\.com\/(?:[^/\s]+\/)?(?:reels?|p|tv)\/[A-Za-z0-9_-]+|youtube\.com\/(?:shorts\/|watch\?v=)[A-Za-z0-9_=&-]+|youtu\.be\/[A-Za-z0-9_-]+|tiktok\.com\/@[^/\s]+\/video\/\d+)[^\s]*/;

export class WatchManager extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.session = null;   // { chatId, media, by }
    this.invite = null;    // { chatId, from, media }
    app.watchHandler = (chatId, from, c) => this.handle(chatId, from, c);
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  open(chatId, url) {
    const media = parseMedia(url);
    if (!media) throw new Error('Paste an Instagram reel, YouTube short or TikTok link');
    this.session = { chatId, media, by: this.app.pk };
    this.invite = null;
    this.app.sendChatControl(chatId, { t: 'watch', a: 'open', url: media.url }, true);
    this.emit('update');
    return media;
  }
  join() {
    if (!this.invite) return;
    this.session = { chatId: this.invite.chatId, media: this.invite.media, by: this.invite.from };
    this.app.sendChatControl(this.invite.chatId, { t: 'watch', a: 'join' }, true);
    this.invite = null;
    this.emit('update');
  }
  dismiss() { this.invite = null; this.emit('update'); }
  close() {
    if (!this.session) return;
    this.app.sendChatControl(this.session.chatId, { t: 'watch', a: 'close' }, true);
    this.session = null;
    this.emit('update');
  }
  handle(chatId, from, c) {
    if (c.a === 'open') {
      const media = parseMedia(c.url); if (!media) return;
      if (this.session && this.session.chatId === chatId) {
        if (this.session.media.embed !== media.embed) { this.session.media = media; this.session.by = from; this.emit('changed', { from }); }
        this.emit('update');
      } else {
        this.invite = { chatId, from, media };
        this.emit('invite', this.invite);
      }
    } else if (c.a === 'join') {
      if (this.session && this.session.chatId === chatId) this.emit('joined', { from });
    } else if (c.a === 'close') {
      if (this.invite && this.invite.chatId === chatId && this.invite.from === from) { this.invite = null; this.emit('update'); }
      if (this.session && this.session.chatId === chatId) this.emit('left', { from });
    }
  }
}
