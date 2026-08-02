/**
 * Reading and writing the three things operators actually hand us: a .csv, a
 * .xlsx saved from Excel, and a sheet exported out of Google Sheets (which is
 * one of those two).
 *
 * Everything is keyed by the header row, so a column the user moved or a column
 * we do not know about does not shift the data. Values come back as strings —
 * coercion belongs to the caller that knows what the column means.
 */

export type SheetRow = Record<string, string>;

/**
 * RFC 4180 CSV: quoted fields may contain commas, newlines and doubled quotes.
 *
 * Hand-written rather than pulled from a dependency because this is the whole
 * of it — the moment a real dialect problem shows up (semicolon separators from
 * an Arabic Windows locale, say), that is the moment to reach for a library.
 */
export const parseCsv = (text: string): string[][] => {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first header.
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index += 1; continue;
      }
      field += char; index += 1; continue;
    }

    if (char === '"') { quoted = true; index += 1; continue; }
    if (char === ',') { row.push(field); field = ''; index += 1; continue; }
    if (char === '\r' || char === '\n') {
      // CRLF is one break, not two.
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row);
      row = []; field = ''; index += 1; continue;
    }
    field += char; index += 1;
  }

  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // Trailing blank lines are an artefact of the export, not empty records.
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
};

/** Header row + data rows -> objects keyed by header. */
export const toRows = (grid: string[][]): SheetRow[] => {
  const [headers, ...body] = grid;
  if (!headers) return [];
  const keys = headers.map(header => header.trim());
  return body.map(cells => {
    const row: SheetRow = {};
    keys.forEach((key, column) => { if (key) row[key] = (cells[column] ?? '').trim(); });
    return row;
  });
};

// ------------------------------------------------------------- cell values

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * A number as typed by a human: Arabic-Indic digits, an Arabic decimal
 * separator, a thousands separator, a stray currency word. Anything that is not
 * a number at all reads as `fallback` rather than NaN, so one bad cell does not
 * poison a whole import.
 */
export const toNumber = (value: string, fallback = 0): number => {
  const latin = [...value.trim()]
    .map(char => {
      const arabic = ARABIC_INDIC.indexOf(char);
      if (arabic >= 0) return String(arabic);
      const eastern = EASTERN_ARABIC.indexOf(char);
      if (eastern >= 0) return String(eastern);
      if (char === '٫') return '.'; // Arabic decimal separator
      if (char === '٬' || char === ',') return ''; // thousands separators
      return char;
    })
    .join('');

  const match = latin.match(/-?\d*\.?\d+/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TRUE_WORDS = ['نعم', 'مفعل', 'مفعلة', 'متاح', 'true', 'yes', 'y', '1'];
const FALSE_WORDS = ['لا', 'موقوف', 'موقوفة', 'غير متاح', 'false', 'no', 'n', '0'];

/** Yes/no as an operator would write it, in either language. */
export const toBoolean = (value: string, fallback = true): boolean => {
  const text = value.trim().toLowerCase();
  if (text === '') return fallback;
  if (TRUE_WORDS.includes(text)) return true;
  if (FALSE_WORDS.includes(text)) return false;
  return fallback;
};

const isExcel = (name: string) => /\.xlsx?$/i.test(name);

/** exceljs is ~940 kB, so it is only fetched when someone opens a spreadsheet. */
const readExcel = async (file: File): Promise<string[][]> => {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, excelRow => {
    const cells: string[] = [];
    // 1-based, and `values[0]` is always empty padding.
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      cells.push(cellText(excelRow.getCell(column).value));
    }
    grid.push(cells);
  });
  return grid;
};

/** Flattens the union exceljs returns for a cell into the text a human sees. */
const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    // Formula cells carry their computed result; hyperlinks carry their text.
    if ('result' in cell) return cellText(cell.result);
    if ('text' in cell) return cellText(cell.text);
    if ('richText' in cell && Array.isArray(cell.richText)) {
      return cell.richText.map(part => String((part as { text?: string }).text ?? '')).join('');
    }
    if ('error' in cell) return '';
    return '';
  }
  return String(value);
};

export const readSheet = async (file: File): Promise<SheetRow[]> =>
  toRows(isExcel(file.name) ? await readExcel(file) : parseCsv(await file.text()));

// ---------------------------------------------------------------- writing

const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const toCsv = (headers: string[], rows: SheetRow[]): string =>
  [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))]
    .map(cells => cells.map(cell => csvCell(String(cell))).join(','))
    .join('\r\n');

const save = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * The BOM is not decoration: without it Excel reads a UTF-8 CSV as the local
 * ANSI codepage and every Arabic name opens as mojibake.
 */
export const downloadCsv = (filename: string, headers: string[], rows: SheetRow[]) =>
  save(new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), filename);

export const downloadXlsx = async (filename: string, headers: string[], rows: SheetRow[]) => {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('data', { views: [{ rightToLeft: true }] });

  sheet.addRow(headers).font = { bold: true };
  rows.forEach(row => sheet.addRow(headers.map(header => row[header] ?? '')));
  sheet.columns.forEach((column, index) => {
    const longest = Math.max(headers[index]?.length ?? 0, ...rows.map(row => (row[headers[index]] ?? '').length));
    column.width = Math.min(Math.max(longest + 2, 10), 40);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  save(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
};
