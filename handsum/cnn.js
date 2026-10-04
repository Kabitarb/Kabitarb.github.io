// Tiny CNN inference for 28x28 handwritten digits (weights exported from train.py as int8 JSON).
export class DigitNet {
  constructor(spec) {
    this.mean = spec.mean;
    this.std = spec.std;
    this.classes = spec.classes;
    this.layers = spec.layers.map((l) => ({
      ...l,
      w: DigitNet.dequant(l.w),
      b: DigitNet.dequant(l.b),
    }));
  }

  static async load(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`model load failed: ${res.status}`);
    return new DigitNet(await res.json());
  }

  static dequant(t) {
    const bin = atob(t.data);
    const out = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      let v = bin.charCodeAt(i);
      if (v > 127) v -= 256;
      out[i] = v * t.scale;
    }
    return { data: out, shape: t.shape };
  }

  // input: Float32Array(784) in [0,1]. Returns {label, conf, probs}.
  predict(input) {
    let x = new Float32Array(784);
    for (let i = 0; i < 784; i++) x[i] = (input[i] - this.mean) / this.std;
    let c = 1, h = 28, w = 28;
    for (const layer of this.layers) {
      if (layer.type === 'conv') {
        const [O, C] = layer.w.shape;
        const out = new Float32Array(O * h * w);
        const W = layer.w.data, B = layer.b.data;
        for (let o = 0; o < O; o++) {
          const bias = B[o];
          for (let y = 0; y < h; y++) {
            for (let xx = 0; xx < w; xx++) {
              let acc = bias;
              for (let ci = 0; ci < C; ci++) {
                const wBase = ((o * C + ci) * 9);
                const xBase = ci * h * w;
                for (let ky = -1; ky <= 1; ky++) {
                  const yy = y + ky;
                  if (yy < 0 || yy >= h) continue;
                  const row = xBase + yy * w;
                  const wRow = wBase + (ky + 1) * 3;
                  for (let kx = -1; kx <= 1; kx++) {
                    const xk = xx + kx;
                    if (xk < 0 || xk >= w) continue;
                    acc += x[row + xk] * W[wRow + kx + 1];
                  }
                }
              }
              out[(o * h + y) * w + xx] = acc > 0 ? acc : 0;
            }
          }
        }
        c = O;
        if (layer.pool === 2) {
          const h2 = h >> 1, w2 = w >> 1;
          const pooled = new Float32Array(c * h2 * w2);
          for (let ch = 0; ch < c; ch++) {
            for (let y = 0; y < h2; y++) {
              for (let xx = 0; xx < w2; xx++) {
                const i0 = (ch * h + 2 * y) * w + 2 * xx;
                const m = Math.max(out[i0], out[i0 + 1], out[i0 + w], out[i0 + w + 1]);
                pooled[(ch * h2 + y) * w2 + xx] = m;
              }
            }
          }
          x = pooled; h = h2; w = w2;
        } else {
          x = out;
        }
      } else {
        const [O, I] = layer.w.shape;
        const out = new Float32Array(O);
        const W = layer.w.data, B = layer.b.data;
        for (let o = 0; o < O; o++) {
          let acc = B[o];
          const base = o * I;
          for (let i = 0; i < I; i++) acc += x[i] * W[base + i];
          out[o] = layer.relu && acc < 0 ? 0 : acc;
        }
        x = out;
      }
    }
    let max = -Infinity;
    for (let i = 0; i < x.length; i++) if (x[i] > max) max = x[i];
    let sum = 0;
    const probs = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) { probs[i] = Math.exp(x[i] - max); sum += probs[i]; }
    let label = 0;
    for (let i = 0; i < x.length; i++) { probs[i] /= sum; if (probs[i] > probs[label]) label = i; }
    return { label, conf: probs[label], probs };
  }
}
