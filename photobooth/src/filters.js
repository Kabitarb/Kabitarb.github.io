// Photo filters — applied per-cell only (frames/text/stickers never filtered).
// WebGL1 shader + 2D getImageData fallback. Params: brightness, contrast,
// saturation, warmth, tint[3], sepia, shadows, highlights, grain, vignette,
// bloom (soft glow), smooth (bilateral skin smoothing), sharpen, leak.

export const FILTERS = [
  { id: 'original',   name: 'Original',       p: {} },
  { id: 'beauty',     name: 'Beauty 뽀샤시',   p: { smooth: 0.7, brightness: 0.06, tint: [0.02, 0.005, 0.015], bloom: 0.3, saturation: 0.04 } },
  { id: 'bw',         name: 'B&W',            p: { saturation: -1, contrast: 0.12 } },
  { id: 'sepia',      name: 'Sepia',          p: { sepia: 1, contrast: 0.02 } },
  { id: 'softpink',   name: 'Soft Pink',      p: { tint: [0.07, 0.01, 0.03], brightness: 0.04, saturation: 0.05, bloom: 0.15 } },
  { id: 'peachy',     name: 'Peachy',         p: { warmth: 0.14, tint: [0.05, 0.015, -0.01], brightness: 0.03, saturation: 0.08 } },
  { id: 'cleangirl',  name: 'Clean Girl',     p: { brightness: 0.08, contrast: 0.10, warmth: 0.05, fade: 0.02, saturation: 0.05, sharpen: 0.25 } },
  { id: 'latte',      name: 'Latte',          p: { warmth: 0.16, tint: [0.05, 0.02, -0.03], saturation: -0.22, shadows: 0.10, fade: 0.08 } },
  { id: 'y2kflash',   name: 'Y2K Flash',      p: { brightness: 0.14, highlights: -0.10, contrast: 0.16, warmth: -0.06, vignette: 0.28, saturation: -0.05 } },
  { id: 'disposable', name: 'Disposable 90s', p: { warmth: 0.14, grain: 0.35, contrast: -0.04, fade: 0.10, leak: 0.5, saturation: -0.08 } },
  { id: 'golden',     name: 'Golden Hour',    p: { warmth: 0.24, tint: [0.07, 0.03, -0.04], brightness: 0.03, saturation: 0.10, bloom: 0.12 } },
  { id: 'seoulblue',  name: 'Seoul Blue',     p: { warmth: -0.16, brightness: 0.06, saturation: 0.02, tint: [-0.01, 0.01, 0.05], fade: 0.06 } },
  { id: 'dreamy',     name: 'Dreamy',         p: { bloom: 0.65, brightness: 0.05, warmth: 0.06, saturation: 0.08, fade: 0.08 } },
  { id: 'milk',       name: 'Milk',           p: { contrast: -0.18, brightness: 0.06, saturation: -0.10, fade: 0.18 } },
  { id: 'vintage',    name: 'Vintage',        p: { warmth: 0.18, contrast: -0.06, saturation: -0.28, fade: 0.18, grain: 0.28, vignette: 0.28 } },
  { id: 'noir',       name: 'Noir',           p: { saturation: -1, contrast: 0.32, brightness: -0.03, vignette: 0.22 } },
];
export function getFilter(id) { return FILTERS.find(f => f.id === id) || FILTERS[0]; }

const VERT = `attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
const FRAG = `precision mediump float;varying vec2 v;uniform sampler2D t;
uniform float uB,uC,uS,uW,uF,uG,uV,uBloom,uI,uSepia,uSh,uHi,uSmooth,uSharp,uLeak,uBeauty;
uniform vec3 uTint;uniform vec2 uRes;uniform float uSeed;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453);}
vec3 lu(vec2 uv){return texture2D(t,uv).rgb;}
float skin(vec3 c){
  float y=dot(c,vec3(.299,.587,.114));
  float cbv=(c.b-y)*.564+0.5, crv=(c.r-y)*.713+0.5;
  return smoothstep(0.,1.,(1.-abs((cbv-.44)*5.))*(1.-abs((crv-.62)*5.))+.001);
}
void main(){
  float sm=max(uSmooth,uBeauty*.8);
  vec3 c=lu(v);
  if(sm>0.){
    vec2 r=min(uRes.x,uRes.y)*0.008/uRes;
    vec3 acc=c; float w=1.;
    for(int i=0;i<12;i++){
      float a=float(i)*6.2832/12.; vec2 off=vec2(cos(a),sin(a))*r;
      vec3 t1=lu(v+off),t2=lu(v+off*1.6),t3=lu(v+off*2.4);
      float w1=exp(-8.*distance(t1,c));float w2=exp(-8.*distance(t2,c));float w3=exp(-8.*distance(t3,c));
      acc+=t1*w1+t2*w2+t3*w3;w+=w1+w2+w3;
    }
    vec3 smc=acc/w;
    c=mix(c,smc,sm*clamp(skin(c)*2.5,0.,1.));
  }
  c+=uB+uBeauty*.05;
  if(uBloom>0.){
    vec2 px=4./uRes;vec3 b=(lu(v+vec2(px.x,px.y))+lu(v+vec2(-px.x,px.y))+lu(v+vec2(px.x,-px.y))+lu(v+vec2(-px.x,-px.y)))*.25;
    c=mix(c,max(c,b),uBloom*.5);
  }
  if(uSepia>0.){
    vec3 s=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131)));
    c=mix(c,s,uSepia);
  }
  c+=uTint;
  float l=dot(c,vec3(.299,.587,.114));
  c=mix(vec3(l),c,1.+uS);
  c.r+=uW*.5;c.b-=uW*.5;
  // shadows lift / highlights compress
  c+=uSh*smoothstep(.5,0.,l)*.25;
  c-=uHi*smoothstep(.5,1.,l)*.2;
  c=(c-.5)*(1.+uC)+.5;
  c=c*(1.-uF)+vec3(.08)*uF;
  if(uSharp>0.){
    vec2 px=1.5/uRes;
    vec3 n=lu(v-vec2(0.,px.y))+lu(v+vec2(0.,px.y))+lu(v-vec2(px.x,0.))+lu(v+vec2(px.x,0.));
    c+= (c-n*.25)*uSharp;
  }
  c-=uV*smoothstep(.35,.9,distance(v,vec2(.5)))*.3;
  if(uLeak>0.){
    float d=distance(v,vec2(1.,0.));
    c+=vec3(.5,.15,-.1)*uLeak*smoothstep(1.,.1,d)*.35;
  }
  c+=(hash(v*uRes)-.5)*uG*.15;
  vec3 orig=lu(v);
  gl_FragColor=vec4(clamp(mix(orig,c,uI),0.,1.),1.);
}`;

let gl = null, glCanvas = null, prog = null, tex = null, ok = false;
function initGL() {
  if (gl !== null || ok) return;
  try {
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) { gl = null; return; }
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s);
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    tex = gl.createTexture();
    ok = true;
  } catch (e) { gl = null; ok = false; }
}
const U = {};
function uni(n) { return U[n] ?? (U[n] = gl.getUniformLocation(prog, n)); }

const outCanvas = document.createElement('canvas');
// beauty: 0..1 extra smoothing/brighten layered on the chosen filter
export function applyFilter(source, sw, sh, filter, intensity, beauty = 0) {
  intensity = intensity == null ? 1 : intensity;
  const p = filter.p || {};
  if (filter.id === 'original' && intensity <= 0 && !beauty) {
    outCanvas.width = sw; outCanvas.height = sh;
    outCanvas.getContext('2d').drawImage(source, 0, 0, sw, sh);
    return outCanvas;
  }
  if (filter.id === 'original' && !beauty) {
    outCanvas.width = sw; outCanvas.height = sh;
    outCanvas.getContext('2d').drawImage(source, 0, 0, sw, sh);
    return outCanvas;
  }
  initGL();
  if (ok) {
    try { return applyGL(source, sw, sh, p, intensity, beauty); } catch (e) { ok = false; }
  }
  return applyCPU(source, sw, sh, p, intensity, beauty);
}
function applyGL(source, w, h, p, i, beauty) {
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; gl.viewport(0, 0, w, h); }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const f1 = (n, v) => gl.uniform1f(uni(n), v);
  f1('uB', p.brightness || 0); f1('uC', p.contrast || 0); f1('uS', p.saturation || 0);
  f1('uW', p.warmth || 0); f1('uF', p.fade || 0); f1('uG', p.grain || 0);
  f1('uV', p.vignette || 0); f1('uBloom', p.bloom || p.softGlow || 0);
  f1('uSepia', p.sepia || 0); f1('uSh', p.shadows || 0); f1('uHi', p.highlights || 0);
  f1('uSmooth', p.smooth || 0); f1('uSharp', p.sharpen || 0); f1('uLeak', p.leak || 0);
  f1('uBeauty', beauty); f1('uI', i);
  const t = p.tint || [0, 0, 0];
  gl.uniform3f(uni('uTint'), t[0], t[1], t[2]);
  gl.uniform2f(uni('uRes'), w, h);
  gl.uniform1f(uni('uSeed'), 3.7);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  outCanvas.width = w; outCanvas.height = h;
  outCanvas.getContext('2d').drawImage(glCanvas, 0, 0);
  return outCanvas;
}
// 2D fallback: color ops only (smoothing skipped or cheap blur blend in skin mask)
function applyCPU(source, w, h, p, i, beauty) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(source, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h), a = d.data;
  const b = (p.brightness || 0) + beauty * 0.05, ct = p.contrast || 0, s = p.saturation || 0,
        wr = p.warmth || 0, f = p.fade || 0, v = p.vignette || 0,
        sep = p.sepia || 0, sh = p.shadows || 0, hi = p.highlights || 0;
  const tn = p.tint || [0, 0, 0];
  for (let px = 0; px < a.length; px += 4) {
    const oR = a[px], oG = a[px + 1], oB = a[px + 2];
    let r = oR / 255, g = oG / 255, bl = oB / 255;
    r += b; g += b; bl += b;
    if (sep) {
      const sr = .393 * r + .769 * g + .189 * bl, sg = .349 * r + .686 * g + .168 * bl, sb = .272 * r + .534 * g + .131 * bl;
      r += (sr - r) * sep; g += (sg - g) * sep; bl += (sb - bl) * sep;
    }
    r += tn[0]; g += tn[1]; bl += tn[2];
    const l = .299 * r + .587 * g + .114 * bl;
    r = l + (r - l) * (1 + s); g = l + (g - l) * (1 + s); bl = l + (bl - l) * (1 + s);
    r += wr * .5; bl -= wr * .5;
    const lift = Math.max(0, Math.min(1, (.5 - l) / .5)) * sh * .25;
    r += lift; g += lift; bl += lift;
    const comp = Math.max(0, Math.min(1, (l - .5) / .5)) * hi * .2;
    r -= comp; g -= comp; bl -= comp;
    r = (r - .5) * (1 + ct) + .5; g = (g - .5) * (1 + ct) + .5; bl = (bl - .5) * (1 + ct) + .5;
    r = r * (1 - f) + .08 * f; g = g * (1 - f) + .08 * f; bl = bl * (1 - f) + .08 * f;
    const idx = px / 4, xx = idx % w, yy = (idx / w) | 0;
    const dv = Math.hypot(xx / w - .5, yy / h - .5);
    const vig = v * Math.max(0, Math.min(1, (dv - .35) / .55)) * .3;
    r -= vig; g -= vig; bl -= vig;
    a[px]     = Math.max(0, Math.min(255, (oR / 255 + (r - oR / 255) * i) * 255));
    a[px + 1] = Math.max(0, Math.min(255, (oG / 255 + (g - oG / 255) * i) * 255));
    a[px + 2] = Math.max(0, Math.min(255, (oB / 255 + (bl - oB / 255) * i) * 255));
  }
  x.putImageData(d, 0, 0);
  return c;
}
