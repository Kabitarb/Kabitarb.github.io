import { escapeHtml, filterProjects, type Project } from './data';
import { icon } from './icons';

export function projectVisual(index: number): string {
  if (index === 0) {
    const bars = Array.from({ length: 35 }, (_, i) => {
      const height = 8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.3)) * 42;
      return `<i style="--bar-height:${height}px;--delay:${i * -0.07}s"></i>`;
    }).join('');
    return `<div class="project-visual visual-music" aria-hidden="true">
      <div class="visual-topline"><span>01 — AUDIO INTELLIGENCE</span><span>✳</span></div>
      <div class="music-window"><div class="window-head"><i></i><i></i><i></i><span>SOUND → SIGNAL</span></div><div class="waveform">${bars}</div><div class="audio-timeline"></div><div class="genre-row"><span>Genre classification</span><b>♪</b></div></div>
      <span class="visual-caption">LISTEN. LEARN. CLASSIFY.</span></div>`;
  }
  if (index === 1) {
    return `<div class="project-visual visual-health" aria-hidden="true">
      <div class="visual-topline"><span>02 — HEALTH × DATA</span><span>+</span></div>
      <div class="health-window"><div class="health-head"><span class="health-cross">+</span><span>Patterns in health data</span></div><svg class="health-line" viewBox="0 0 170 60"><line x1="0" y1="30" x2="170" y2="30"/><line x1="0" y1="50" x2="170" y2="50"/><path d="M0 32h23l7-7 9 17 12-32 11 40 9-22 7 4h23l7-7 9 16 8-26 11 22 8-5h26"/></svg><div class="health-bottom"><span>Explore</span><span>Compare</span><span>Understand</span></div></div>
      <span class="visual-caption">A MORE THOUGHTFUL PREDICTION.</span></div>`;
  }
  return `<div class="project-visual visual-honey" aria-hidden="true">
    <div class="visual-topline"><span>03 — DATA IN NATURE</span><span>⬡</span></div>
    <div class="honey-window"><div class="honey-head">Honey production <span>⬡</span></div><svg class="honey-chart" viewBox="0 0 170 90"><line x1="0" y1="15" x2="170" y2="15"/><line x1="0" y1="40" x2="170" y2="40"/><line x1="0" y1="65" x2="170" y2="65"/><path d="m0 24 18-7 18 18 18-6 18 21 18-8 18 13 18-3"/><path class="forecast" d="m126 52 19 8 25 10"/><circle cx="18" cy="17" r="2.5"/><circle cx="72" cy="50" r="2.5"/><circle cx="126" cy="52" r="2.5"/></svg><div class="honey-chart-labels"><span>HISTORICAL DATA</span><span>FORECAST →</span></div></div>
    <span class="visual-caption">FINDING THE STORY IN THE NUMBERS.</span></div>`;
}

export function renderProjects(projects: Project[], category: string): string {
  return filterProjects(projects, category)
    .map((project) => {
      const index = projects.indexOf(project);
      return `<article class="project-card">${projectVisual(index)}<div class="project-body">
      <div class="project-kicker"><span>${escapeHtml(project.category)}</span><span>0${index + 1}</span></div>
      <h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.description)}</p>
      <div class="project-tags">${project.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="project-bottom"><button class="case-link" data-project="${index}" aria-label="Read case study: ${escapeHtml(project.title)}">Inside the project ${icon('arrow-up-right')}</button><a href="${escapeHtml(project.source)}" target="_blank" rel="noopener noreferrer" aria-label="Source code: ${escapeHtml(project.title)}">${icon('github')}</a></div>
    </div></article>`;
    })
    .join('');
}

export function renderCaseStudy(project: Project, index: number): string {
  return `${projectVisual(index)}<div class="case-body">
    <p class="eyebrow">${escapeHtml(project.category)} · PROJECT NOTES</p><h2 id="case-title">${escapeHtml(project.title)}</h2>
    <p class="case-intro">${escapeHtml(project.description)}</p>
    <dl class="case-meta"><div><dt>My role</dt><dd>${escapeHtml(project.role)}</dd></div><div><dt>Toolkit</dt><dd>${project.tags.map(escapeHtml).join(' · ')}</dd></div></dl>
    <section class="case-section"><h3>The question</h3><p>${escapeHtml(project.problem)}</p></section>
    <section class="case-section"><h3>The approach</h3><p>${escapeHtml(project.approach)}</p></section>
    <section class="case-section"><h3>The outcome & what I learned</h3><p>${escapeHtml(project.outcome)}</p></section>
    <div class="case-actions"><a class="button button-primary" href="${escapeHtml(project.source)}" target="_blank" rel="noopener noreferrer">${icon('github')} Explore the code ${icon('arrow-up-right')}</a>${project.demo ? `<a class="button" href="${escapeHtml(project.demo)}" target="_blank" rel="noopener noreferrer">Live demo ${icon('arrow-up-right')}</a>` : ''}</div>
    <p class="case-disclaimer">The visual above is an illustration of the project concept, not a live prediction or a performance chart. Source code contains the implementation and experiment details.</p>
  </div>`;
}
