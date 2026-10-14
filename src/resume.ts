import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Portfolio } from './data';

export async function createResume(data: Portfolio): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 785;
  const margin = 48;
  const width = 499;
  const purple = rgb(0.43, 0.34, 0.53);
  const ink = rgb(0.2, 0.18, 0.23);
  const normalize = (value: string) =>
    value
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/→/g, 'to');

  const write = (value: string, size = 10, strong = false, color = ink) => {
    const font = strong ? bold : regular;
    const words = normalize(value).split(/\s+/);
    let line = '';
    const flush = () => {
      if (y < 55) {
        page = pdf.addPage([595.28, 841.89]);
        y = 785;
      }
      page.drawText(line, { x: margin, y, size, font, color });
      y -= size * 1.55;
      line = '';
    };
    for (const word of words) {
      for (const character of `${word} `) {
        if (font.widthOfTextAtSize(line + character, size) > width) flush();
        line += character;
      }
    }
    if (line) flush();
  };
  const heading = (value: string) => {
    y -= 20;
    write(value.toUpperCase(), 9, true, purple);
    y -= 5;
  };
  pdf.setTitle(`${data.profile.name} — Resume`);
  pdf.setAuthor(data.profile.name);
  write(data.profile.name, 26, true, purple);
  write(data.profile.role, 12);
  y -= 9;
  write(data.profile.email, 9);
  write(data.profile.github, 9);
  write(data.profile.linkedin, 9);
  heading('Profile');
  write(data.profile.about);
  y -= 5;
  write(data.profile.approach);
  heading('Education');
  write(data.profile.degree, 11, true);
  write(data.profile.school);
  heading('Project experience');
  for (const project of data.projects) {
    write(project.title, 12, true);
    write(project.role, 9);
    write(project.description);
    write(`Tools: ${project.tags.join(', ')}`, 9);
    write(project.source, 8);
    y -= 12;
  }
  heading('Project toolkit');
  write(
    [...new Set(data.projects.flatMap((project) => project.tags))].join(
      '  ·  ',
    ),
  );
  const bytes = await pdf.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
