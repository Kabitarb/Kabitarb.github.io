import { describe, expect, it } from 'vitest';
import {
  defaultPortfolio,
  escapeHtml,
  filterProjects,
  safeUrl,
  serializePortfolio,
  validatePortfolio,
} from '../src/data';
import { renderCaseStudy, renderProjects } from '../src/projects';

describe('portfolio validation and rendering', () => {
  it('rejects executable URLs, credential URLs, and malformed email addresses', () => {
    expect(() => safeUrl('javascript:alert(1)')).toThrow();
    expect(() => safeUrl('data:text/html,test')).toThrow();
    expect(() => safeUrl('https://user:password@example.com')).toThrow();
    expect(() => safeUrl('/relative')).toThrow();
    expect(safeUrl('', true)).toBe('');
    expect(safeUrl('https://github.com/Kabitarb')).toBe(
      'https://github.com/Kabitarb',
    );
    const data = structuredClone(defaultPortfolio);
    data.profile.email = 'not-an-email';
    expect(() => validatePortfolio(data)).toThrow('valid email');
  });

  it('rejects incomplete or excessive project data', () => {
    const data = structuredClone(defaultPortfolio);
    data.projects[0].tags = [];
    expect(() => validatePortfolio(data)).toThrow('one and six');
    expect(() =>
      validatePortfolio({ ...defaultPortfolio, projects: [] }),
    ).toThrow('three');
    expect(() =>
      validatePortfolio({ ...defaultPortfolio, profile: null }),
    ).toThrow();
  });

  it('treats all editable content as text and prevents script-tag breakouts', () => {
    const data = structuredClone(defaultPortfolio);
    data.profile.name = '</script><script>alert(1)</script>';
    data.projects[0].title = '<img src=x onerror=alert(1)>';
    const serialized = serializePortfolio(data);
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized).profile.name).toBe(data.profile.name);
    const html = renderProjects(data.projects, 'all');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(escapeHtml('"<&')).toBe('&quot;&lt;&amp;');
  });

  it('keeps project identities stable while filtering and omits nonexistent demos', () => {
    expect(filterProjects(defaultPortfolio.projects, 'all')).toHaveLength(3);
    expect(
      filterProjects(defaultPortfolio.projects, 'Machine Learning'),
    ).toHaveLength(2);
    const html = renderProjects(defaultPortfolio.projects, 'Data Science');
    expect(html).toContain('data-project="2"');
    expect(html).not.toContain('data-project="0"');
    expect(renderCaseStudy(defaultPortfolio.projects[0], 0)).not.toContain(
      'Live demo',
    );
    const withDemo = {
      ...defaultPortfolio.projects[0],
      demo: 'https://example.com/demo',
    };
    expect(renderCaseStudy(withDemo, 0)).toContain('Live demo');
  });
});
