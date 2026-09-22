import {
  defaultPortfolio,
  validatePortfolio,
  escapeHtml,
  type Portfolio,
  type Profile,
  type SavedPortfolio,
} from './data';
import { fillIcons } from './icons';
import { renderProjects, renderCaseStudy } from './projects';
import {
  loadPortfolio,
  savePortfolio,
  preparePhoto,
  validateResume,
} from './storage';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing page element: ${selector}`);
  return found;
}

const published = document.documentElement.dataset.published === 'true';
const embedded = document.querySelector('#portfolio-data')?.textContent;
let data: Portfolio = structuredClone(defaultPortfolio);
if (embedded) {
  try {
    data = validatePortfolio(JSON.parse(embedded));
  } catch {
    /* Keep the original portfolio if a published snapshot is damaged. */
  }
}
let state: SavedPortfolio = { data, photo: null, resume: null };
let activeFilter = 'all';
let photoUrl: string | null = null;
let toastTimer = 0;
const caseDialog = element<HTMLDialogElement>('#case-dialog');

export function toast(message: string): void {
  const target = element('#toast');
  target.textContent = message;
  target.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => target.classList.remove('visible'),
    4200,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function render(): void {
  const profile = state.data.profile;
  document.querySelectorAll<HTMLElement>('[data-profile]').forEach((node) => {
    const key = node.dataset.profile;
    if (key && Object.hasOwn(profile, key))
      node.textContent = profile[key as keyof Profile];
  });
  document
    .querySelectorAll<HTMLAnchorElement>('[data-link]')
    .forEach((link) => {
      if (link.dataset.link === 'email')
        link.href = `mailto:${encodeURIComponent(profile.email)}`;
      if (link.dataset.link === 'github') link.href = profile.github;
      if (link.dataset.link === 'linkedin') link.href = profile.linkedin;
    });
  if (!published) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = state.photo ? URL.createObjectURL(state.photo) : null;
    document
      .querySelectorAll<HTMLImageElement>('.profile-photo')
      .forEach((image) => {
        image.src = photoUrl ?? './assets/portrait.webp';
        image.alt = `${profile.name}, ${profile.role}`;
      });
  }
  document.title = `${profile.name} — ${profile.role}`;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', profile.tagline);
  document
    .querySelector('meta[property="og:title"]')
    ?.setAttribute('content', document.title);
  document
    .querySelector('meta[property="og:description"]')
    ?.setAttribute('content', profile.tagline);
  element('#year').textContent = String(new Date().getFullYear());
  updateFilter(activeFilter);
}

function updateFilter(category: string): void {
  activeFilter = category;
  element('#projects-grid').innerHTML = renderProjects(
    state.data.projects,
    category,
  );
  document
    .querySelectorAll<HTMLButtonElement>('[data-filter]')
    .forEach((button) => {
      const active = button.dataset.filter === category;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
}

function setupDialog(dialog: HTMLDialogElement): void {
  dialog
    .querySelectorAll('[data-close]')
    .forEach((button) =>
      button.addEventListener('click', () => dialog.close()),
    );
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
}

setupDialog(caseDialog);
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const project = event.target.closest<HTMLButtonElement>('[data-project]');
  if (project) {
    const index = Number(project.dataset.project);
    if (!state.data.projects[index]) return;
    element('#case-content').innerHTML = renderCaseStudy(
      state.data.projects[index],
      index,
    );
    caseDialog.showModal();
    caseDialog.scrollTop = 0;
  }
  const filter = event.target.closest<HTMLElement>(
    '[data-filter], [data-skill-filter]',
  );
  if (filter)
    updateFilter(filter.dataset.filter ?? filter.dataset.skillFilter ?? 'all');
});

const menuButton = element<HTMLButtonElement>('.menu-toggle');
const mobileMenu = element('#mobile-menu');
function closeMenu(): void {
  mobileMenu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}
menuButton.addEventListener('click', () => {
  mobileMenu.hidden = !mobileMenu.hidden;
  menuButton.setAttribute('aria-expanded', String(!mobileMenu.hidden));
  menuButton.setAttribute(
    'aria-label',
    mobileMenu.hidden ? 'Open navigation' : 'Close navigation',
  );
});
mobileMenu
  .querySelectorAll('a, button')
  .forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});
window.matchMedia('(min-width: 641px)').addEventListener('change', closeMenu);

element('#copy-email').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.data.profile.email);
    toast('Email copied. Let’s make something good.');
  } catch {
    toast(`Copy this email: ${state.data.profile.email}`);
  }
});

document
  .querySelectorAll<HTMLButtonElement>('[data-action="resume"]')
  .forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { downloadBlob } = await import('./export');
        let blob = state.resume;
        if (published) {
          const response = await fetch('./assets/resume.pdf');
          if (!response.ok)
            throw new Error(
              'The resume could not be downloaded. Please contact me by email.',
            );
          blob = await response.blob();
        }
        if (!blob) {
          const { createResume } = await import('./resume');
          blob = await createResume(state.data);
        }
        downloadBlob(
          blob,
          `${state.data.profile.shortName.replace(/[^\p{L}\p{N}-]/gu, '-')}-Resume.pdf`,
        );
        toast('Your resume download is ready.');
      } catch (error) {
        toast(errorMessage(error));
      } finally {
        button.disabled = false;
      }
    });
  });

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        document
          .querySelectorAll<HTMLAnchorElement>('.nav-link, .nav-contact')
          .forEach((link) => {
            const active = link.hash === `#${entry.target.id}`;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
          });
      }
    },
    { rootMargin: '-15% 0px -55% 0px', threshold: 0 },
  );
  document
    .querySelectorAll('main > section[id]')
    .forEach((section) => observer.observe(section));
}

async function setupStudio(): Promise<void> {
  const studio = element<HTMLDialogElement>('#studio-dialog');
  const form = element<HTMLFormElement>('#studio-form');
  const error = element('#studio-error');
  const saveButton = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const exportButton = element<HTMLButtonElement>('#export-site');
  let draftPhoto: Blob | null = null;
  let draftResume: Blob | null = null;
  let previewUrl: string | null = null;
  let revision = 0;
  let busy = 0;
  let loaded = false;
  form.noValidate = true;
  setupDialog(studio);

  function switchTab(tab: string, focus = false): void {
    document
      .querySelectorAll<HTMLButtonElement>('[data-tab]')
      .forEach((button) => {
        const active = button.dataset.tab === tab;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        element(`#panel-${button.dataset.tab}`).hidden = !active;
        if (active && focus) button.focus();
      });
  }
  const tabs = Array.from(
    studio.querySelectorAll<HTMLButtonElement>('[data-tab]'),
  );
  tabs.forEach((button, index) => {
    button.addEventListener('click', () =>
      switchTab(button.dataset.tab ?? 'profile'),
    );
    button.addEventListener('keydown', (event) => {
      let target: number | undefined;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft')
        target = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== undefined) {
        event.preventDefault();
        switchTab(tabs[target].dataset.tab ?? 'profile', true);
      }
    });
  });

  function projectFields(): void {
    const field = (
      index: number,
      key: string,
      title: string,
      value: string,
      multiline = false,
      optional = false,
    ) => {
      const name = `project-${index}-${key}`;
      const attrs = `name="${name}" ${optional ? '' : 'required'} maxlength="${multiline ? 2000 : 500}"`;
      return `<label>${title}${multiline ? `<textarea ${attrs} rows="4">${escapeHtml(value)}</textarea>` : `<input ${attrs} type="${key === 'source' || key === 'demo' ? 'url' : 'text'}" value="${escapeHtml(value)}" />`}</label>`;
    };
    element('#project-fields').innerHTML = state.data.projects
      .map(
        (
          project,
          index,
        ) => `<details class="project-editor"><summary>0${index + 1} — ${escapeHtml(project.title)}</summary>
      ${field(index, 'title', 'Project title', project.title)}
      <label>Category<select name="project-${index}-category"><option${project.category === 'Machine Learning' ? ' selected' : ''}>Machine Learning</option><option${project.category === 'Data Science' ? ' selected' : ''}>Data Science</option></select></label>
      ${field(index, 'description', 'Short summary', project.description, true)}
      ${field(index, 'tags', 'Tools (comma separated, up to six)', project.tags.join(', '))}
      ${field(index, 'role', 'Your role / project type', project.role)}
      ${field(index, 'problem', 'The problem', project.problem, true)}
      ${field(index, 'approach', 'Your approach', project.approach, true)}
      ${field(index, 'outcome', 'Outcomes, learnings & limitations', project.outcome, true)}
      ${field(index, 'source', 'Source code URL', project.source)}
      ${field(index, 'demo', 'Live demo URL (optional)', project.demo, false, true)}
    </details>`,
      )
      .join('');
  }

  function showPreview(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = draftPhoto ? URL.createObjectURL(draftPhoto) : null;
    element<HTMLImageElement>('#upload-preview').src =
      previewUrl ?? './assets/portrait.webp';
    element('#resume-status').textContent = draftResume
      ? 'Your uploaded PDF is selected.'
      : 'A starter PDF is generated from your profile.';
    element('#reset-resume').hidden = !draftResume;
  }

  function openStudio(): void {
    if (!loaded) {
      toast('Loading your saved profile. Please try again in a moment.');
      return;
    }
    revision += 1;
    draftPhoto = state.photo;
    draftResume = state.resume;
    for (const [key, value] of Object.entries(state.data.profile)) {
      const input = form.elements.namedItem(key);
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
      )
        input.value = value;
    }
    projectFields();
    showPreview();
    error.textContent = '';
    switchTab('profile');
    studio.showModal();
    studio.scrollTop = 0;
  }
  document
    .querySelectorAll('[data-action="edit"]')
    .forEach((button) => button.addEventListener('click', openStudio));
  studio.addEventListener('close', () => {
    revision += 1;
  });

  function readForm(): Portfolio {
    const fields = new FormData(form);
    const value = (key: string) => String(fields.get(key) ?? '').trim();
    return validatePortfolio({
      profile: Object.fromEntries(
        Object.keys(defaultPortfolio.profile).map((key) => [key, value(key)]),
      ),
      projects: state.data.projects.map((project, index) => ({
        ...project,
        ...Object.fromEntries(
          [
            'title',
            'category',
            'description',
            'role',
            'problem',
            'approach',
            'outcome',
            'source',
            'demo',
          ].map((key) => [key, value(`project-${index}-${key}`)]),
        ),
        tags: value(`project-${index}-tags`)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })),
    });
  }

  function setBusy(change: number): void {
    busy += change;
    saveButton.disabled = busy > 0;
    exportButton.disabled = busy > 0;
  }
  for (const kind of ['photo', 'resume'] as const) {
    const input = element<HTMLInputElement>(`#${kind}-input`);
    element(`[data-upload="${kind}"]`).addEventListener('click', () =>
      input.click(),
    );
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const currentRevision = revision;
      error.textContent = '';
      setBusy(1);
      try {
        const blob =
          kind === 'photo'
            ? await preparePhoto(file)
            : await validateResume(file);
        if (revision !== currentRevision) return;
        if (kind === 'photo') draftPhoto = blob;
        else draftResume = blob;
        showPreview();
        toast(
          `${kind === 'photo' ? 'Photo' : 'Resume'} selected. Save changes to keep it.`,
        );
      } catch (failure) {
        if (revision === currentRevision)
          error.textContent = errorMessage(failure);
      } finally {
        setBusy(-1);
        input.value = '';
      }
    });
  }
  element('#reset-photo').addEventListener('click', () => {
    draftPhoto = null;
    showPreview();
  });
  element('#reset-resume').addEventListener('click', () => {
    draftResume = null;
    showPreview();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    error.textContent = '';
    const invalid = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      ':invalid',
    );
    if (invalid) {
      switchTab(
        invalid.closest('[role="tabpanel"]')?.id.replace('panel-', '') ??
          'profile',
      );
      const details = invalid.closest('details');
      if (details) details.open = true;
      invalid.reportValidity();
      return;
    }
    setBusy(1);
    try {
      const next = { data: readForm(), photo: draftPhoto, resume: draftResume };
      await savePortfolio(next);
      state = next;
      render();
      toast('Saved. Your portfolio is a little more you.');
    } catch (failure) {
      error.textContent = errorMessage(failure);
    } finally {
      setBusy(-1);
    }
  });
  exportButton.addEventListener('click', async () => {
    if (busy) return;
    error.textContent = '';
    setBusy(1);
    try {
      if (
        JSON.stringify(readForm()) !== JSON.stringify(state.data) ||
        draftPhoto !== state.photo ||
        draftResume !== state.resume
      )
        throw new Error('Save your changes before downloading your website.');
      toast('Preparing your website. This may take a moment.');
      const { exportWebsite, downloadBlob } = await import('./export');
      downloadBlob(await exportWebsite(state), 'my-portfolio.zip');
      toast('Your website is ready to download.');
    } catch (failure) {
      error.textContent = errorMessage(failure);
    } finally {
      setBusy(-1);
    }
  });
  try {
    const saved = await loadPortfolio();
    if (saved) {
      state = saved;
      render();
    }
  } catch (failure) {
    toast(errorMessage(failure));
  } finally {
    loaded = true;
  }
}

fillIcons();
render();
if (!published) void setupStudio();
