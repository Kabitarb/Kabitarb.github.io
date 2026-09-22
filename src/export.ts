import { strToU8, zipSync } from 'fflate';
import {
  serializePortfolio,
  type Portfolio,
  type SavedPortfolio,
} from './data';
import { createResume } from './resume';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function exportDocument(
  source: string,
  data: Portfolio,
  hasPhoto: boolean,
): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.documentElement.dataset.published = 'true';
  doc.documentElement.classList.add('published');
  doc
    .querySelectorAll('#studio-dialog, [data-action="edit"], #portfolio-data')
    .forEach((node) => node.remove());
  const payload = doc.createElement('script');
  payload.type = 'application/json';
  payload.id = 'portfolio-data';
  payload.textContent = serializePortfolio(data);
  doc.head.append(payload);
  doc.title = `${data.profile.name} — ${data.profile.role}`;
  doc.querySelectorAll<HTMLElement>('[data-profile]').forEach((node) => {
    const key = node.dataset.profile;
    if (key && Object.hasOwn(data.profile, key))
      node.textContent = data.profile[key as keyof typeof data.profile];
  });
  doc.querySelectorAll<HTMLAnchorElement>('[data-link]').forEach((node) => {
    if (node.dataset.link === 'email')
      node.href = `mailto:${encodeURIComponent(data.profile.email)}`;
    if (node.dataset.link === 'github') node.href = data.profile.github;
    if (node.dataset.link === 'linkedin') node.href = data.profile.linkedin;
  });
  doc.querySelectorAll<HTMLImageElement>('.profile-photo').forEach((image) => {
    if (hasPhoto) image.src = './assets/custom-photo.webp';
    image.alt = `${data.profile.name}, ${data.profile.role}`;
  });
  doc
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', data.profile.tagline);
  doc
    .querySelector('meta[property="og:title"]')
    ?.setAttribute('content', doc.title);
  doc
    .querySelector('meta[property="og:description"]')
    ?.setAttribute('content', data.profile.tagline);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

async function fetchFile(path: string): Promise<Uint8Array> {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok)
    throw new Error(`Could not download ${path}. Please retry.`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function exportWebsite(state: SavedPortfolio): Promise<Blob> {
  const response = await fetch(
    new URL('./asset-manifest.json', document.baseURI),
  );
  if (!response.ok)
    throw new Error(
      'Website export requires the production build. Run npm run build and npm run preview first.',
    );
  let manifest: unknown;
  try {
    manifest = await response.json();
  } catch {
    throw new Error('Website export requires the production build preview.');
  }
  if (
    !Array.isArray(manifest) ||
    !manifest.every(
      (path: unknown) =>
        typeof path === 'string' &&
        /^[\w./-]+$/.test(path) &&
        !path.includes('..') &&
        !path.startsWith('/'),
    )
  ) {
    throw new Error('The website asset manifest is invalid.');
  }
  const entries = await Promise.all(
    manifest.map(
      async (path: string) => [path, await fetchFile(`./${path}`)] as const,
    ),
  );
  const files: Record<string, Uint8Array> = Object.fromEntries(entries);
  if (!files['index.html'])
    throw new Error('The website index is missing from the build.');
  files['index.html'] = strToU8(
    exportDocument(
      new TextDecoder().decode(files['index.html']),
      state.data,
      Boolean(state.photo),
    ),
  );
  if (state.photo)
    files['assets/custom-photo.webp'] = new Uint8Array(
      await state.photo.arrayBuffer(),
    );
  const resume = state.resume ?? (await createResume(state.data));
  files['assets/resume.pdf'] = new Uint8Array(await resume.arrayBuffer());
  files['READ-ME.txt'] = strToU8(
    'Your portfolio is ready to publish.\n\nUpload the contents of this folder to a static website host, preserving the directory structure. The index.html file belongs at the site root. For GitHub Pages, use a branch that serves these exported files or upload them through a Pages deployment workflow.\n\nTo view locally, serve this folder using a local web server. JavaScript modules require HTTP rather than opening index.html directly as a file.\n\nThis export includes your saved photo, profile, project content, and resume. It does not include the portfolio editor. To make further changes, return to your original portfolio studio and export again.\n',
  );
  return new Blob([new Uint8Array(zipSync(files, { level: 6 }))], {
    type: 'application/zip',
  });
}
