// gen-templates.mjs: generate 4 simple A4 placeholder PDFs that ship as
// built-in templates. Run with: `node scripts/gen-templates.mjs`
//
// Note: pdf-lib's built-in standard fonts are WinAnsi-encoded and can't
// render CJK code points, so the visible text is Latin-only. The
// `bilingualLabels` map below feeds the "Name" / "Description" fields
// shown in the in-app start page (those go through React, not the PDF).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';

const titles = {
  resume: {
    heading: 'Resume',
    lines: [
      'Name:  ____________________',
      'Email: ___________________',
      'Phone: ___________________',
      '',
      'Experience',
      '----------------',
      '- Senior Engineer ........ 2022 - present',
      '- Engineer ............... 2018 - 2022',
      '',
      'Education',
      '----------------',
      '- B.Sc. Computer Science',
    ],
  },
  invoice: {
    heading: 'Invoice',
    lines: [
      'No.   ____________',
      'Date: ___________',
      '',
      'Item                       Qty      Price',
      '---------------------------------------------',
      'Service A                  1        $___',
      'Service B                  2        $___',
      'Service C                  1        $___',
      '',
      'Subtotal:                          $___',
      'Tax:                               $___',
      'Total:                             $___',
    ],
  },
  contract: {
    heading: 'Contract',
    lines: [
      'Party A: ____________________________',
      'Party B: ____________________________',
      '',
      'Terms:',
      '1.  ____________________________',
      '2.  ____________________________',
      '3.  ____________________________',
      '',
      'Effective date: ___________________',
      '',
      'Signature: ________________________',
    ],
  },
  notes: {
    heading: 'Notes',
    lines: Array(24).fill('_________________________________________'),
  },
};

await mkdir('public/templates', { recursive: true });

for (const [name, t] of Object.entries(titles)) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(t.heading, {
    x: 50,
    y: 780,
    size: 24,
    font,
    color: rgb(0.1, 0.1, 0.4),
  });
  const body = await doc.embedFont(StandardFonts.Helvetica);
  let y = 720;
  for (const line of t.lines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 14,
      font: body,
      color: rgb(0, 0, 0),
    });
    y -= 24;
  }
  const bytes = await doc.save();
  await writeFile(`public/templates/${name}.pdf`, bytes);
  console.log(`  wrote public/templates/${name}.pdf (${bytes.length} B)`);
}

console.log('Generated 4 templates');
