import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { defaultPortfolio, validatePortfolio } from '../src/data';
import { createResume } from '../src/resume';

describe('starter resume', () => {
  it('generates a valid PDF with the current profile and enough pages for long content', async () => {
    const data = structuredClone(defaultPortfolio);
    data.profile.about = 'A thoughtful approach to machine learning. '.repeat(
      17,
    );
    data.profile.approach = data.profile.about;
    for (const project of data.projects) {
      project.description =
        'Exploring datasets and comparing model predictions. '.repeat(6);
    }
    const blob = await createResume(validatePortfolio(data));
    expect(blob.type).toBe('application/pdf');
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    expect(doc.getTitle()).toBe(`${data.profile.name} — Resume`);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
