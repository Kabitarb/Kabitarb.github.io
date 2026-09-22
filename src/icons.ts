const paths: Record<string, string> = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="m3 5 9 7 9-7"/>',
  linkedin:
    '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M7 10v7m0-10v.1M11 17v-7m0 3c0-4 6-4 6 0v4"/>',
  'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v5h14v-5"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-2.5c3-.4 6-1.5 6-6A4.6 4.6 0 0 0 19 6c.3-1 .2-2.5-.2-3-1 0-3 1-3.8 1.5a13 13 0 0 0-6 0C8 4 6 3 5 3c-.5 1-.5 2-.2 3A4.5 4.5 0 0 0 4 9.5c0 4.5 3 5.6 6 6A3.5 3.5 0 0 0 9 18v4"/>',
  camera: '<path d="M8 5h8l2 3h3v12H3V8h3z"/><circle cx="12" cy="13" r="3.5"/>',
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  sprout:
    '<path d="M12 21v-9m0 4C5 17 2 12 3 7c7-1 10 3 9 9zm0-4c-1-6 3-9 9-9 1 6-3 10-9 9z"/>',
  graduation: '<path d="m12 3 11 6-11 6L1 9zm-7 8v6c4 4 10 4 14 0v-6m4-2v8"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  brain:
    '<path d="M12 4C8 0 5 4 5 7c-5 1-4 7-1 8-2 5 5 8 8 4V4zm0 0c4-4 7 0 7 3 5 1 4 7 1 8 2 5-5 8-8 4M5 7l3 2m11-2-3 2M4 15l4-2m12 2-4-2"/>',
  chart: '<path d="M4 3v18h17M8 16l4-6 4 2 5-7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  sliders:
    '<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2M11 3v6M6 9v6m8 0v6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  file: '<path d="M14 2H4v20h16V8zm0 0v6h6M8 13h8m-8 4h5"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
};

export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.sparkles}</svg>`;
}

export function fillIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon ?? '');
  });
}
