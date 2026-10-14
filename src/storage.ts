import { validatePortfolio, type SavedPortfolio } from './data';

const DATABASE = 'kabita-portfolio';
const STORE = 'portfolio';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          'Browser storage is unavailable. Allow site storage to save your portfolio.',
        ),
      );
    request.onblocked = () =>
      reject(new Error('Close other portfolio tabs and try again.'));
  });
}

export async function loadPortfolio(): Promise<SavedPortfolio | null> {
  const db = await openDatabase();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error('Could not read your saved portfolio.'));
    });
    if (value === undefined) return null;
    if (
      !value ||
      typeof value !== 'object' ||
      !('data' in value) ||
      !('photo' in value) ||
      !('resume' in value)
    )
      throw new Error(
        'Saved data could not be read. Save your details again in Personalize.',
      );
    if (value.photo !== null && !(value.photo instanceof Blob))
      throw new Error('Saved photo could not be read.');
    if (value.resume !== null && !(value.resume instanceof Blob))
      throw new Error('Saved resume could not be read.');
    return {
      data: validatePortfolio(value.data),
      photo: value.photo,
      resume: value.resume,
    };
  } finally {
    db.close();
  }
}

export async function savePortfolio(value: SavedPortfolio): Promise<void> {
  const data = validatePortfolio(value.data);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ ...value, data }, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          new Error(
            'Could not save. Your browser storage may be full or disabled.',
          ),
        );
      transaction.onerror = () =>
        reject(
          new Error(
            'Could not save. Your browser storage may be full or disabled.',
          ),
        );
    });
  } finally {
    db.close();
  }
}

export async function preparePhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 8 * 1024 * 1024)
    throw new Error('Please choose a photo smaller than 8 MB.');
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('This image could not be read. Try a different photo.');
  });
  try {
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Could not process this photo.')),
        'image/webp',
        0.88,
      );
    });
  } finally {
    image.close();
  }
}

export async function validateResume(file: File): Promise<Blob> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Please choose a PDF smaller than 10 MB.');
  const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (header !== '%PDF-') throw new Error('Please upload a valid PDF resume.');
  return new Blob([await file.arrayBuffer()], { type: 'application/pdf' });
}
