// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { defaultPortfolio } from '../src/data';
import { exportDocument, exportWebsite } from '../src/export';

const html = readFileSync('index.html', 'utf8');
afterEach(() => vi.unstubAllGlobals());

describe('publishable website export', () => {
  it('embeds safe content and removes editor controls', () => {
    const data = structuredClone(defaultPortfolio);
    data.profile.name = '</script><img src=x onerror=alert(1)>';
    data.profile.email = 'custom@example.com';
    const output = exportDocument(html, data, true);
    const doc = new DOMParser().parseFromString(output, 'text/html');
    expect(doc.querySelector('#studio-dialog')).toBeNull();
    expect(doc.querySelector('[data-action="edit"]')).toBeNull();
    expect(doc.querySelector('img[onerror]')).toBeNull();
    expect(doc.documentElement.dataset.published).toBe('true');
    expect(doc.querySelector('.profile-photo')?.getAttribute('src')).toBe(
      './assets/custom-photo.webp',
    );
    expect(doc.querySelector('[data-link="email"]')?.getAttribute('href')).toBe(
      'mailto:custom%40example.com',
    );
    expect(
      JSON.parse(doc.querySelector('#portfolio-data')!.textContent!).profile
        .name,
    ).toBe(data.profile.name);
  });

  it('packages the selected photo and resume as files, with no data URIs', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const files: Record<string, string> = {
      'asset-manifest.json': JSON.stringify([
        'index.html',
        'assets/main.js',
        'assets/main.css',
      ]),
      'index.html': html,
      'assets/main.js': 'console.log("portfolio")',
      'assets/main.css': 'body { color: purple; }',
    };
    vi.stubGlobal('fetch', async (url: URL) => {
      const path = url.pathname.replace(/^\//, '');
      return new Response(files[path] ?? '', {
        status: path in files ? 200 : 404,
      });
    });
    const zip = await exportWebsite({
      data: defaultPortfolio,
      photo: new Blob(['photo'], { type: 'image/webp' }),
      resume: new Blob(['%PDF-test'], { type: 'application/pdf' }),
    });
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(strFromU8(entries['assets/custom-photo.webp'])).toBe('photo');
    expect(strFromU8(entries['assets/resume.pdf'])).toBe('%PDF-test');
    expect(strFromU8(entries['index.html'])).not.toContain('data:image');
    expect(entries['assets/main.js']).toBeDefined();
    expect(entries['READ-ME.txt']).toBeDefined();
  });

  it('reports missing build assets and refuses remote manifest entries', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Not found', { status: 404 }),
    );
    await expect(
      exportWebsite({ data: defaultPortfolio, photo: null, resume: null }),
    ).rejects.toThrow('production build');
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify(['https://example.com/file'])),
    );
    await expect(
      exportWebsite({ data: defaultPortfolio, photo: null, resume: null }),
    ).rejects.toThrow('manifest');
  });
});
