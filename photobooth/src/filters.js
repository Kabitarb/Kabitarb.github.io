// WebGL1 photo filters with a 2D getImageData fallback.
// Params: brightness, contrast, saturation, warmth, fade, grain, vignette, softGlow.

export const FILTERS = [
  { id: 'original', name: 'Original',      p: {} },
  { id: 'bright',   name: '뽀샤시 Bright',  p: { brightness: 0.10, contrast: -0.05, saturation: 0.08, softGlow: 0.5, fade: 0.05 } },
  { id: 'mono',     name: '흑백 Mono',      p: { saturation: -1, contrast: 0.10 } },
  { id: 'film',     name: 'Film',           p: { contrast: 0.08, saturation: -0.15, warmth: 0.10, fade: 0.12, grain: 0.25, vignette: 0.25 } },
  { id: 'milk',     name: 'Milk',           p: { contrast: -0.18, brightness: 0.06, saturation: -0.10, fade: 0.18 } },
  { id: 'peach',    name: 'Peach',          p: { warmth: 0.16, saturation: 0.06, brightness: 0.04 } },
  { id: 'cool',     name: 'Cool',           p: { warmth: -0.14, contrast: 0.05, saturation: 0.05 } },
  { id: 'vintage',  name: 'Vintage',        p: { warmth: 0.20, contrast: -0.08, saturation: -0.30, fade: 0.20, grain: 0.3, vignette: 0.3 } },
  { id: 'dreamy',   name: 'Dreamy',         p: { softGlow: 0.7, brightness: 0.05, warmth: 0.08, saturation: 0.10, fade: 0.08 } },
  { id: 'noir',     name: 'Noir',           p: { saturation: -1, contrast: 0.35, brightness: -0.03, vignette: 0.2 } },
];
export function getFilter(id) { return FILTERS.find(f => f.id === id) || FILTERS[0]; }

const VERT = `attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
const FRAG = `precision mediump float;varying vec2 v;uniform sampler2D t;
uniform float uB,uC,uS,uW,uF,uG,uV,uGlow,uI;uniform vec2 uRes;uniform float uSeed;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453);}
void main(){
  vec3 c=texture2D(t,v).rgb;
  if(uGlow>0.){
    vec3 b=vec3(0.);
    b+=texture2D(t,v+vec2( 4., 4.)/uRes).rgb; b+=texture2D(t,v+vec2(-4., 4.)/uRes).rgb;
    b+=texture2D(t,v+vec2( 4.,-4.)/uRes).rgb; b+=texture2D(t,v+vec2(-4.,-4.)/uRes).rgb;
    b+=texture2D(t,v+vec2(10.,0.)/uRes).rgb; b+=texture2D(t,v+vec2(-10.,0.)/uRes).rgb;
    b+=texture2D(t,v+vec2(0.,10.)/uRes).rgb; b+=texture2D(t,v+vec2(0.,-10.)/uRes).rgb;
    c=mix(c,max(c,b/8.),uGlow*.5);
  }
  c+=uB; c=(c-.5)*(1.+uC)+.5;
  float l=dot(c,vec3(.299,.587,.114)); c=mix(vec3(l),c,1.+uS);
  c.r+=uW*.5; c.b-=uW*.5;
  c=c*(1.-uF)+vec3(.08)*uF;
  c-=uV*smoothstep(.35,.9,distance(v,vec2(.5)))*.3;
  c+=(hash(v*uRes)-.5)*uG*.15;
  vec3 orig=texture2D(t,v).rgb;
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

// source: canvas/ImageBitmap/video. Returns a canvas with the filter applied.
const outCanvas = document.createElement('canvas');
export function applyFilter(source, sw, sh, filter, intensity) {
  intensity = intensity == null ? 1 : intensity;
  const p = filter.p || {};
  const isIdentity = filter.id === 'original' || intensity <= 0;
  if (isIdentity) {
    outCanvas.width = sw; outCanvas.height = sh;
    const c = outCanvas.getContext('2d');
    c.drawImage(source, 0, 0, sw, sh);
    return outCanvas;
  }
  initGL();
  if (ok) {
    try { return applyGL(source, sw, sh, p, intensity); } catch (e) { ok = false; }
  }
  return applyCPU(source, sw, sh, p, intensity);
}
function applyGL(source, w, h, p, i) {
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; gl.viewport(0, 0, w, h); }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.uniform1f(uni('uB'), p.brightness || 0);
  gl.uniform1f(uni('uC'), p.contrast || 0);
  gl.uniform1f(uni('uS'), p.saturation || 0);
  gl.uniform1f(uni('uW'), p.warmth || 0);
  gl.uniform1f(uni('uF'), p.fade || 0);
  gl.uniform1f(uni('uG'), p.grain || 0);
  gl.uniform1f(uni('uV'), p.vignette || 0);
  gl.uniform1f(uni('uGlow'), p.softGlow || 0);
  gl.uniform1f(uni('uI'), i);
  gl.uniform2f(uni('uRes'), w, h);
  gl.uniform1f(uni('uSeed'), 3.7);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  outCanvas.width = w; outCanvas.height = h;
  outCanvas.getContext('2d').drawImage(glCanvas, 0, 0);
  return outCanvas;
}
function applyCPU(source, w, h, p, i) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(source, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h), a = d.data;
  const b = p.brightness || 0, ct = p.contrast || 0, s = p.saturation || 0,
        wr = p.warmth || 0, f = p.fade || 0, v = p.vignette || 0;
  for (let px = 0; px < a.length; px += 4) {
    const oR = a[px], oG = a[px + 1], oB = a[px + 2];
    let r = oR / 255, g = oG / 255, bl = oB / 255;
    r += b; g += b; bl += b;
    r = (r - .5) * (1 + ct) + .5; g = (g - .5) * (1 + ct) + .5; bl = (bl - .5) * (1 + ct) + .5;
    const l = .299 * r + .587 * g + .114 * bl;
    r = l + (r - l) * (1 + s); g = l + (g - l) * (1 + s); bl = l + (bl - l) * (1 + s);
    r += wr * .5; bl -= wr * .5;
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
