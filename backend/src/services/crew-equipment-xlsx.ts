import ExcelJS from 'exceljs';
import { CrewJobEquipment } from './hiretrack-crew-read';

// Excel template for the per-job equipment list handed to crew. One sheet:
// a job header block, then each HireTrack equipment list as its own banner +
// table (sections as sub-headings), colors matching the crew-bookings page.

const PURPLE = 'FF6B2D8F';
const PURPLE_LIGHT = 'FFEFE3F5';
const GREY = 'FFF2F3F5';
const BORDER_COLOR = 'FFB7BFC9';
const LAST_COLUMN = 5; // A..E
const DEFAULT_SECTION_TITLE = 'Default Section Header'; // HireTrack's own placeholder name

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: BORDER_COLOR } },
  left: { style: 'thin', color: { argb: BORDER_COLOR } },
  bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
  right: { style: 'thin', color: { argb: BORDER_COLOR } },
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

// HireTrack timestamps come back as naive local ISO strings - format them
// by hand rather than through Date, which would shift them by timezone.
function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!match) return iso;
  const [, y, m, d, hh, mm] = match;
  const date = `${d}.${m}.${y}`;
  return hh && mm && !(hh === '00' && mm === '00') ? `${date} ${hh}:${mm}` : date;
}

function mergedRow(sheet: ExcelJS.Worksheet, rowNumber: number): ExcelJS.Row {
  sheet.mergeCells(rowNumber, 1, rowNumber, LAST_COLUMN);
  return sheet.getRow(rowNumber);
}

export async function renderCrewEquipmentXlsx(data: CrewJobEquipment, generatedAt: Date = new Date()): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HireTrack Crew Bookings';
  workbook.created = generatedAt;

  const sheet = workbook.addWorksheet('Оборудование', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&L&8&F&R&8Стр. &P из &N' },
  });
  sheet.columns = [{ width: 6 }, { width: 58 }, { width: 30 }, { width: 10 }, { width: 40 }];

  let rowNumber = 1;

  const title = mergedRow(sheet, rowNumber);
  title.getCell(1).value = 'Список оборудования';
  title.getCell(1).font = { bold: true, size: 16 };
  title.height = 26;
  rowNumber += 2;

  const { job } = data;
  const headerRows: [string, string][] = [
    ['Работа', job.reference],
    ['Название', job.title],
    ['Клиент', job.client],
    ['Площадка', job.venue],
    ['Даты', [formatDateTime(job.dueOut), formatDateTime(job.dueBack)].filter(Boolean).join(' — ')],
    ['Crew Boss', job.crewBoss],
    ['Статус', job.status],
    [
      'Выгружено',
      `${pad(generatedAt.getDate())}.${pad(generatedAt.getMonth() + 1)}.${generatedAt.getFullYear()} ` +
        `${pad(generatedAt.getHours())}:${pad(generatedAt.getMinutes())}`,
    ],
  ];
  for (const [label, value] of headerRows) {
    sheet.mergeCells(rowNumber, 1, rowNumber, 2);
    sheet.mergeCells(rowNumber, 3, rowNumber, LAST_COLUMN);
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    row.getCell(3).value = value || '—';
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    for (let c = 1; c <= LAST_COLUMN; c += 1) row.getCell(c).border = thinBorder;
    rowNumber += 1;
  }
  rowNumber += 1;

  if (data.eqlists.length === 0) {
    const empty = mergedRow(sheet, rowNumber);
    empty.getCell(1).value = 'У этой работы нет списков оборудования.';
    empty.getCell(1).font = { italic: true };
  }

  for (const list of data.eqlists) {
    const banner = mergedRow(sheet, rowNumber);
    const dates = [formatDateTime(list.dateOut), formatDateTime(list.dateBack)].filter(Boolean).join(' — ');
    banner.getCell(1).value = [list.title, list.status, dates].filter(Boolean).join('  ·  ');
    banner.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    banner.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE } };
    banner.getCell(1).alignment = { vertical: 'middle', wrapText: true };
    banner.height = 22;
    rowNumber += 1;

    const head = sheet.getRow(rowNumber);
    ['№', 'Наименование', 'Категория', 'Кол-во', 'Примечание'].forEach((text, i) => {
      const cell = head.getCell(i + 1);
      cell.value = text;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
      cell.alignment = { horizontal: i === 0 || i === 3 ? 'center' : 'left', vertical: 'middle' };
      cell.border = thinBorder;
    });
    rowNumber += 1;

    const showSectionTitles =
      list.sections.length > 1 || list.sections.some((s) => s.title && s.title !== DEFAULT_SECTION_TITLE);
    let lineNumber = 0;
    let totalQuantity = 0;

    for (const section of list.sections) {
      if (showSectionTitles) {
        const sectionRow = mergedRow(sheet, rowNumber);
        sectionRow.getCell(1).value = section.title && section.title !== DEFAULT_SECTION_TITLE ? section.title : 'Без раздела';
        sectionRow.getCell(1).font = { bold: true };
        sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PURPLE_LIGHT } };
        for (let c = 1; c <= LAST_COLUMN; c += 1) sectionRow.getCell(c).border = thinBorder;
        rowNumber += 1;
      }
      for (const line of section.lines) {
        lineNumber += 1;
        if (!line.isFreeText) totalQuantity += line.quantity;
        const row = sheet.getRow(rowNumber);
        row.getCell(1).value = lineNumber;
        row.getCell(2).value = line.name;
        row.getCell(3).value = line.category;
        row.getCell(4).value = line.isFreeText ? null : line.quantity;
        row.getCell(5).value = line.notes;
        row.getCell(2).font = { italic: line.isFreeText };
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
        row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
        row.getCell(4).alignment = { horizontal: 'center', vertical: 'top' };
        row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
        for (let c = 1; c <= LAST_COLUMN; c += 1) row.getCell(c).border = thinBorder;
        rowNumber += 1;
      }
    }

    sheet.mergeCells(rowNumber, 1, rowNumber, 3);
    const total = sheet.getRow(rowNumber);
    total.getCell(1).value = `Итого по списку (позиций: ${lineNumber})`;
    total.getCell(1).alignment = { horizontal: 'right' };
    total.getCell(4).value = totalQuantity;
    total.getCell(4).alignment = { horizontal: 'center' };
    for (let c = 1; c <= LAST_COLUMN; c += 1) {
      total.getCell(c).font = { bold: true };
      total.getCell(c).border = thinBorder;
    }
    rowNumber += 2;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
