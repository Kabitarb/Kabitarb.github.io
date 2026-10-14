import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPortfolio } from '../src/data';
import {
  loadPortfolio,
  preparePhoto,
  savePortfolio,
  validateResume,
} from '../src/storage';

beforeEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('kabita-portfolio');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('persistent portfolio storage', () => {
  it('round-trips profile changes and binary uploads together', async () => {
    expect(await loadPortfolio()).toBeNull();
    const data = structuredClone(defaultPortfolio);
    data.profile.name = 'My updated name';
    const photo = new Blob(['image-content'], { type: 'image/webp' });
    const resume = new Blob(['%PDF-test'], { type: 'application/pdf' });
    await savePortfolio({ data, photo, resume });
    const saved = await loadPortfolio();
    expect(saved?.data.profile.name).toBe('My updated name');
    expect(await saved?.photo?.text()).toBe('image-content');
    expect(await saved?.resume?.text()).toBe('%PDF-test');
    await savePortfolio({ data, photo: null, resume: null });
    expect((await loadPortfolio())?.photo).toBeNull();
  });

  it('does not overwrite a valid saved profile with invalid data', async () => {
    await savePortfolio({ data: defaultPortfolio, photo: null, resume: null });
    const invalid = structuredClone(defaultPortfolio);
    invalid.projects[0].source = 'javascript:alert(1)';
    await expect(
      savePortfolio({ data: invalid, photo: null, resume: null }),
    ).rejects.toThrow();
    expect((await loadPortfolio())?.data).toEqual(defaultPortfolio);
  });

  it('reports unavailable browser storage', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('Storage denied');
      },
    });
    await expect(loadPortfolio()).rejects.toThrow('Storage denied');
  });
});

describe('uploads', () => {
  it('checks PDF content rather than trusting the filename', async () => {
    await expect(
      validateResume(
        new File(['not a PDF'], 'resume.pdf', { type: 'application/pdf' }),
      ),
    ).rejects.toThrow('valid PDF');
    await expect(
      validateResume(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf'),
      ),
    ).rejects.toThrow('10 MB');
    const pdf = await validateResume(
      new File(['%PDF-1.7\nbody'], 'resume.pdf'),
    );
    expect(pdf.type).toBe('application/pdf');
  });

  it('rejects unsafe image types, oversized files, and corrupt images', async () => {
    await expect(
      preparePhoto(
        new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }),
      ),
    ).rejects.toThrow('JPG, PNG');
    await expect(
      preparePhoto(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.jpg', {
          type: 'image/jpeg',
        }),
      ),
    ).rejects.toThrow('8 MB');
    vi.stubGlobal('createImageBitmap', () =>
      Promise.reject(new Error('Invalid image')),
    );
    await expect(
      preparePhoto(new File(['corrupt'], 'image.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('could not be read');
  });
});
