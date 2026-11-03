// Local preview: serves the site and runs backend/Code.gs against an in-memory
// fake of the Google Sheets APIs it uses, at /api. Run: node dev/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8090);

function fakeSheet(name) {
  const cells = [];
  let maxRows = 1000;
  const sheet = {
    getName: () => name,
    getMaxRows: () => maxRows,
    getLastRow: () => {
      for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some((v) => v !== '' && v != null)) return r + 1;
      return 0;
    },
    insertRowsAfter: (_after, n) => { maxRows += n; },
    getRange: (row, col, numRows = 1, numCols = 1) => {
      if (row < 1 || col < 1 || row + numRows - 1 > maxRows) throw new Error(`range out of bounds: ${row},${col},${numRows},${numCols}`);
      const range = {
        getDisplayValues: () => Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numCols }, (_, c) => String(cells[row - 1 + r]?.[col - 1 + c] ?? ''))),
        setValues: (values) => {
          if (values.length !== numRows || values.some((v) => v.length !== numCols)) throw new Error('setValues: dimensions do not match range');
          values.forEach((v, r) => v.forEach((x, c) => {
            (cells[row - 1 + r] ||= [])[col - 1 + c] = x;
          }));
          return range;
        },
      };
      for (const m of ['setFontWeight', 'setBackground', 'setFontColor', 'setWrap', 'setNumberFormat', 'setDataValidation']) range[m] = () => range;
      return range;
    },
    setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {}, hideColumns() {},
    dump: () => cells,
  };
  return sheet;
}

const sheets = [fakeSheet('Sheet1')];
const spreadsheet = {
  getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
  insertSheet: (n, i = sheets.length) => {
    if (spreadsheet.getSheetByName(n)) throw new Error(`sheet ${n} exists`);
    const s = fakeSheet(n); sheets.splice(i, 0, s); return s;
  },
  getSheets: () => [...sheets],
  deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
};
const validationBuilder = () => {
  const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) };
  return b;
};
const pad = (n) => String(n).padStart(2, '0');
const context = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, newDataValidation: validationBuilder },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    formatDate: (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  },
  Session: { getScriptTimeZone: () => 'Asia/Manila' },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (s) => { const o = { getContent: () => s, setMimeType: () => o }; return o; },
  },
});
for (const file of ['backend/Code.gs', 'backend/Seed.gs']) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
}

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parameter = Object.fromEntries(url.searchParams);
      const out = req.method === 'POST'
        ? context.doPost({ parameter, postData: { contents: body } })
        : context.doGet({ parameter });
      // Small delay so loading states are visible while testing.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out.getContent());
      }, 350);
    });
    return;
  }
  if (url.pathname === '/__sheet') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(sheets.map((s) => [s.getName(), s.dump()]))));
    return;
  }
  const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Preview: http://localhost:${port}`));
