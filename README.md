# Kabita — AI & Machine Learning portfolio

A responsive portfolio with original project illustrations, accessible case-study dialogs, project filters, a photo/resume editor, local persistence, and a portable website export. Built with TypeScript and Vite; no backend or runtime credentials are required.

## Run locally

Use Node 24 (`.nvmrc`). If using nvm:

```sh
nvm use
npm ci
npm run dev
```

The development server uses port 5173 by default. For a production preview, including website export:

```sh
npm run build
npm run preview
```

The production preview uses port 4173. The ZIP export requires the production build's asset manifest and intentionally reports an error on a source-only dev server.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Tests cover unsafe links and markup, project filtering, persistence of profile/uploads, invalid file uploads, publishable exports, and PDF generation. These are automated unit/integration checks; they do not replace testing in a real browser. There are no pre-commit hooks in this repository.

## Personalize

Use **Personalize** in the footer or the camera button on the portrait:

- **Profile:** change your details and upload a JPEG, PNG, or WebP photo (up to 8 MB). Photos are resized to a maximum dimension of 1400 pixels and saved as a Blob, not an embedded data URI.
- **Resume:** upload a PDF (up to 10 MB), or use the starter PDF generated from the current profile, education, and project summaries. Review the starter before sending it to employers. Its standard PDF font supports Latin text; upload your own PDF if you need other scripts.
- **Projects:** edit three projects, their categories, tools, source links, optional demo links, and case studies.
- **Save changes:** persist the profile and files together in IndexedDB. Closing without saving discards staged edits. No content is uploaded to a server. Private-browsing restrictions or clearing site storage can remove local customizations.
- **Export:** save first, then download the ready-to-host ZIP. It includes compiled scripts, styles, fonts, your selected photo, and a PDF resume. Extract and serve the files over HTTP. The export removes editor controls and ignores browser-stored drafts.

For permanent defaults in this repository, edit `src/data.ts`. Update the introductory HTML if the baseline profile changes so metadata and non-JavaScript content remain consistent. Toolkit cards and the editorial headline live in `index.html`.

## Publishing

This change does not publish the site automatically. The GitHub Actions workflow validates pull requests and uploads the `dist` artifact. To publish after review:

1. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. Do this before merging: the source HTML references TypeScript and must be built, so it should not be served directly from a branch.
2. Merge the portfolio change.
3. Run the **Portfolio** workflow manually from the default branch. The explicit manual run builds and deploys `dist` to GitHub Pages.

Alternatively, upload the ZIP exported from Portfolio Studio to any static host. All paths support a subdirectory deployment. The old `projects.html` URL redirects to the work section.

## Content and attribution

Profile and education come from the original portfolio. Project summaries are based on the public Music-Genre-Classification, Diabetes_Prediction, and Honey-Prediction repositories. No employment history, performance metrics, live demos, or client endorsements have been invented. Project card graphics are conceptual illustrations, labelled as such in each case study.

The portrait is the existing repository photo, converted to WebP. DM Sans and Instrument Serif are self-hosted; their OFL licenses are in `public/fonts`.
