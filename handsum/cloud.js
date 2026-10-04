// Cloud recognition via Google Gemini (user-supplied API key, called directly from the browser).
export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (best accuracy)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (faster, cheaper)' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

const PROMPT = `This photo shows handwritten numbers written in one or more vertical columns (each column is one person's points).
List EVERY handwritten number in the image, one entry per number, including numbers that are circled or crossed.
For each number give:
- value: the number exactly as written, digits with an optional decimal point (e.g. "12.5", "7", "0.5", "-3"). Treat a dot or comma between digits as a decimal point. Do not add units or words.
- circled: true only if a circle/oval/ring is drawn around that number, otherwise false.
- box_2d: [ymin, xmin, ymax, xmax] of the digits themselves (not the circle), normalized to 0-1000.
Never merge numbers from different lines into one entry. Ignore printed text, column headings, names and any underline or total line.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    numbers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          value: { type: 'STRING' },
          circled: { type: 'BOOLEAN' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['value', 'circled', 'box_2d'],
      },
    },
  },
  required: ['numbers'],
};

export class CloudError extends Error {
  constructor(message, { status, retryAfterMs } = {}) { super(message); this.status = status; this.retryAfterMs = retryAfterMs; }
}

export async function recognizeGemini({ apiKey, model = 'gemini-2.5-flash', jpegBase64, signal, endpoint }) {
  const url = endpoint || `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const generationConfig = { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 };
  if (/gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } }, { text: PROMPT }] }],
    generationConfig,
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new CloudError('Network error: ' + e.message);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch (_) {}
    if (res.status === 400 && /API key/i.test(msg)) msg = 'API key not valid';
    if (res.status === 429) throw new CloudError('Rate limit reached, slowing down', { status: 429, retryAfterMs: 8000 });
    throw new CloudError(msg, { status: res.status });
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new CloudError('Model returned no JSON');
    parsed = JSON.parse(m[0]);
  }
  return { numbers: normalize(parsed.numbers || []), raw: parsed };
}

function normalize(items) {
  const out = [];
  for (const it of items) {
    if (!Array.isArray(it.box_2d) || it.box_2d.length !== 4) continue;
    let [y0, x0, y1, x1] = it.box_2d.map((v) => Math.max(0, Math.min(1000, Number(v) || 0)) / 1000);
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const text = parseValueText(it.value);
    if (text === null) continue;
    const value = parseFloat(text);
    if (!Number.isFinite(value)) continue;
    out.push({ text, value, circled: !!it.circled, conf: 1, digits: [], box: { x: x0, y: y0, w: Math.max(0.005, x1 - x0), h: Math.max(0.005, y1 - y0) } });
  }
  return out;
}

export function parseValueText(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[,·•]/g, '.').replace(/[−–—]/g, '-').replace(/[^0-9.\-]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  s = s.replace(/^\.+/, '0.').replace(/\.$/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return (neg ? '-' : '') + s;
}
