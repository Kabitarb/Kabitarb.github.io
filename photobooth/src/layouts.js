// Layout definitions. All coordinates in "design units" (du):
//   2x6  strip    = 600 x 1800   (300 dpi)
//   6x2  strip    = 1800 x 600
//   4x6 landscape = 1800 x 1200
//   4x6 portrait  = 1200 x 1800
// Cells: {x,y,w,h}. Text blocks: {roles:['title'|'subtitle'|'date'|'titledate'],x,y,w,h,align,size}
//   'titledate' renders title on the left and date on the right of one line.
//   size is a relative font-size factor (du scale ~ block height).

export const SIZES = {
  '2x6':  { w: 600,  h: 1800, label: '2x6 Strip' },
  '6x2':  { w: 1800, h: 600,  label: '6x2 Strip' },
  '4x6L': { w: 1800, h: 1200, label: '4x6 Photo (landscape)' },
  '4x6P': { w: 1200, h: 1800, label: '4x6 Photo (portrait)' },
};

const M = 30, G = 18;

export const LAYOUTS = [
  {
    id: 'A', name: 'Classic Text', size: '2x6',
    cells: [
      { x: M, y: 30,  w: 540, h: 430 },
      { x: M, y: 478, w: 540, h: 430 },
      { x: M, y: 926, w: 540, h: 430 },
    ],
    text: [{ roles: ['title', 'date'], x: 30, y: 1366, w: 540, h: 404, align: 'center' }],
  },
  {
    id: 'B', name: 'Wedding Day', size: '2x6',
    cells: [
      { x: M, y: 205, w: 540, h: 408 },
      { x: M, y: 631, w: 540, h: 408 },
      { x: M, y: 1057, w: 540, h: 408 },
    ],
    text: [
      { roles: ['subtitle'], x: 30, y: 30, w: 540, h: 160, align: 'center' },
      { roles: ['title', 'date'], x: 30, y: 1485, w: 540, h: 285, align: 'center' },
    ],
  },
  {
    id: 'C', name: 'Big Header', size: '2x6',
    cells: [
      { x: M, y: 480,  w: 540, h: 425 },
      { x: M, y: 923,  w: 540, h: 425 },
      { x: M, y: 1366, w: 540, h: 404 },
    ],
    text: [{ roles: ['title', 'date'], x: 30, y: 30, w: 540, h: 430, align: 'center' }],
  },
  {
    id: 'D', name: 'Life 4 Cuts', size: '2x6',
    cells: [
      { x: M, y: 30,   w: 540, h: 397 },
      { x: M, y: 445,  w: 540, h: 397 },
      { x: M, y: 860,  w: 540, h: 397 },
      { x: M, y: 1275, w: 540, h: 397 },
    ],
    text: [{ roles: ['titledate'], x: 30, y: 1688, w: 540, h: 82, align: 'center' }],
  },
  {
    id: 'E', name: 'Header 4 Cuts', size: '2x6',
    cells: [
      { x: M, y: 138,  w: 540, h: 397 },
      { x: M, y: 553,  w: 540, h: 397 },
      { x: M, y: 968,  w: 540, h: 397 },
      { x: M, y: 1383, w: 540, h: 387 },
    ],
    text: [{ roles: ['titledate'], x: 30, y: 30, w: 540, h: 92, align: 'center' }],
  },
  {
    id: 'F', name: 'Duo Header', size: '2x6',
    cells: [
      { x: M, y: 480,  w: 540, h: 510 },
      { x: M, y: 1008, w: 540, h: 510 },
    ],
    text: [
      { roles: ['title', 'date'], x: 30, y: 30, w: 540, h: 430, align: 'center' },
      { roles: ['subtitle'], x: 30, y: 1536, w: 540, h: 234, align: 'center' },
    ],
  },
  {
    id: 'G', name: 'Duo Footer', size: '2x6',
    cells: [
      { x: M, y: 300, w: 540, h: 501 },
      { x: M, y: 819, w: 540, h: 501 },
    ],
    text: [
      { roles: ['subtitle'], x: 30, y: 30, w: 540, h: 250, align: 'center' },
      { roles: ['title', 'date'], x: 30, y: 1340, w: 540, h: 430, align: 'center' },
    ],
  },
  {
    id: 'H', name: 'Wide Duo', size: '6x2',
    cells: [
      { x: M,   y: 30, w: 590, h: 540 },
      { x: 638, y: 30, w: 590, h: 540 },
    ],
    text: [{ roles: ['title', 'date'], x: 1258, y: 30, w: 512, h: 540, align: 'center' }],
  },
  {
    id: 'I', name: 'One Big', size: '4x6L',
    cells: [{ x: M, y: 30, w: 1740, h: 1000 }],
    text: [{ roles: ['titledate'], x: 30, y: 1048, w: 1740, h: 122, align: 'center' }],
  },
  {
    id: 'J', name: 'Feature + 3', size: '4x6L',
    cells: [
      { x: M,    y: 30,  w: 1080, h: 690 },
      { x: M,    y: 750, w: 560,  h: 420 },
      { x: 620,  y: 750, w: 560,  h: 420 },
      { x: 1210, y: 750, w: 560,  h: 420 },
    ],
    text: [{ roles: ['title', 'date'], x: 1150, y: 30, w: 620, h: 690, align: 'center' }],
  },
  {
    id: 'K', name: 'Split Left', size: '4x6L',
    cells: [
      { x: M,   y: 30,  w: 870, h: 680 },
      { x: M,   y: 730, w: 870, h: 440 },
      { x: 930, y: 730, w: 840, h: 440 },
    ],
    text: [{ roles: ['title', 'date'], x: 930, y: 30, w: 840, h: 680, align: 'center' }],
  },
  {
    id: 'L', name: 'Split Right', size: '4x6L',
    cells: [
      { x: 900, y: 30,  w: 870, h: 680 },
      { x: M,   y: 730, w: 870, h: 440 },
      { x: 930, y: 730, w: 840, h: 440 },
    ],
    text: [{ roles: ['title', 'date'], x: 30, y: 30, w: 840, h: 680, align: 'center' }],
  },
  {
    id: 'M', name: 'Banner Duo', size: '4x6L',
    cells: [
      { x: M,   y: 312, w: 855, h: 600 },
      { x: 915, y: 312, w: 855, h: 600 },
    ],
    text: [
      { roles: ['titledate'], x: 30, y: 30, w: 1740, h: 264, align: 'center' },
      { roles: ['subtitle'], x: 30, y: 930, w: 1740, h: 240, align: 'center' },
    ],
  },
  {
    id: 'N', name: 'Grid 2x2', size: '4x6L',
    cells: [
      { x: M,   y: 30,  w: 855, h: 490 },
      { x: 915, y: 30,  w: 855, h: 490 },
      { x: M,   y: 538, w: 855, h: 490 },
      { x: 915, y: 538, w: 855, h: 490 },
    ],
    text: [{ roles: ['titledate'], x: 30, y: 1050, w: 1740, h: 120, align: 'center' }],
  },
  {
    id: 'O', name: 'Portrait Duo', size: '4x6P',
    cells: [
      { x: M, y: 30,  w: 1140, h: 690 },
      { x: M, y: 738, w: 1140, h: 690 },
    ],
    text: [{ roles: ['title', 'date'], x: 30, y: 1446, w: 1140, h: 324, align: 'center' }],
  },
  {
    id: 'P', name: 'Grid 네컷', size: '4x6P',
    cells: [
      { x: M,   y: 30,  w: 555, h: 751 },
      { x: 615, y: 30,  w: 555, h: 751 },
      { x: M,   y: 799, w: 555, h: 751 },
      { x: 615, y: 799, w: 555, h: 751 },
    ],
    text: [{ roles: ['titledate'], x: 30, y: 1570, w: 1140, h: 200, align: 'center' }],
  },
  {
    id: 'Q', name: '6 Cuts', size: '4x6P',
    cells: [
      { x: M,   y: 30,   w: 555, h: 507 },
      { x: 615, y: 30,   w: 555, h: 507 },
      { x: M,   y: 555,  w: 555, h: 507 },
      { x: 615, y: 555,  w: 555, h: 507 },
      { x: M,   y: 1080, w: 555, h: 507 },
      { x: 615, y: 1080, w: 555, h: 507 },
    ],
    text: [{ roles: ['titledate'], x: 30, y: 1610, w: 1140, h: 160, align: 'center' }],
  },
  {
    id: 'R', name: 'Polaroid', size: '4x6P',
    cells: [{ x: 60, y: 60, w: 1080, h: 1080 }],
    text: [{ roles: ['title', 'date'], x: 60, y: 1180, w: 1080, h: 540, align: 'center' }],
  },
];

export function getLayout(id) { return LAYOUTS.find(l => l.id === id); }
export function layoutSize(layout) { return SIZES[layout.size]; }
// Export pixel size for a layout ('std'=300dpi, 'hd'=600dpi)
export function exportSize(layout, quality) {
  const s = SIZES[layout.size];
  const k = quality === 'hd' ? 2 : 1;
  return { w: s.w * k, h: s.h * k, scale: k };
}
// 4x6 print sheet with two 2x6 strips side by side
export function printSheetSize(quality) {
  const k = quality === 'hd' ? 2 : 1;
  return { w: 1200 * k, h: 1800 * k, scale: k };
}
