/**
 * Backend for the Mama's 90th site.
 *
 * Lives in a Google Sheet's Apps Script project and is deployed as a web app
 * (Execute as: Me, Who has access: Anyone). The site reads everyone with GET
 * and saves one person at a time with POST. The first request creates the
 * "Sign-Up" and "Summary" tabs and loads SEED (from Seed.gs) if it exists.
 */

var SHEET_NAME = 'Sign-Up';
var SUMMARY_NAME = 'Summary';
var NIGHTS = ['19', '20', '21', '22', '23', '24', '25', '26', '27'];
var ATTENDANCE = ['Yes', 'Maybe', 'No'];
var LODGING = ['Tagaytay Big House', '73 Times', 'Hillcreek', 'QC hotel or other', 'Other / own', 'Need lodging', 'Not needed'];

// Column order matches the original spreadsheet, plus an ID column at the end.
var FIELDS = [
  ['name', 'Full name'],
  ['contact', 'Contact person'],
  ['tagaytay', 'Attending Tagaytay? Feb 21-23, 2027'],
  ['feb25', 'Attending Feb 25?'],
  ['arrDate', 'Arrival date (PH)'],
  ['arrTime', 'Arrival time'],
  ['arrFlight', 'Arrival flight / location'],
  ['depDate', 'Departure date (PH)'],
  ['depTime', 'Departure time'],
  ['depFlight', 'Departure flight / destination']
].concat(NIGHTS.map(function (d) { return ['n' + d, 'Lodging Feb ' + d]; })).concat([
  ['otherNeeds', 'Other dates / needs'],
  ['roomSharing', 'Room sharing with'],
  ['bedPref', 'Bed / room preference'],
  ['notes', 'Accessibility / notes'],
  ['updated', 'Last updated'],
  ['id', 'ID']
]);
var KEYS = FIELDS.map(function (f) { return f[0]; });
var COL = {};
KEYS.forEach(function (k, i) { COL[k] = i + 1; });

function doGet(e) {
  try {
    return json_({ ok: true, people: readAll_(sheet_()) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (body.action !== 'save') return json_({ ok: false, error: 'unknown_action' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var person = clean_(body.person || {});
    if (!person.name) return json_({ ok: false, error: 'name_required' });

    var ids = idColumn_(sh);
    var index = person.id ? ids.indexOf(person.id) : -1;
    if (index >= 0) {
      // `base` is the row as this visitor loaded it. If the row has changed since
      // (another visitor, or an edit made in the sheet), don't overwrite it.
      var current = rowToPerson_(sh.getRange(index + 2, 1, 1, KEYS.length).getDisplayValues()[0]);
      var base = body.base || {};
      var changed = KEYS.some(function (k) { return String(base[k] == null ? '' : base[k]).trim() !== current[k]; });
      if (changed) return json_({ ok: false, error: 'conflict', person: current });
    } else {
      person.id = newId_();
      index = ids.length;
    }
    person.updated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    writeRow_(sh, index + 2, person);
    return json_({ ok: true, person: person, people: readAll_(sh) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor if you want the tabs created before the first visit. */
function setup() {
  sheet_();
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (sh) return sh;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return ss.getSheetByName(SHEET_NAME) || createSheets_(ss);
  } finally {
    lock.releaseLock();
  }
}

function createSheets_(ss) {
  var sh = ss.insertSheet(SHEET_NAME, 0);
  var width = KEYS.length;
  sh.getRange(1, 1, 1, width)
    .setValues([FIELDS.map(function (f) { return f[1]; })])
    .setFontWeight('bold')
    .setBackground('#1f3d32')
    .setFontColor('#ffffff')
    .setWrap(true);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  // Plain text everywhere, so dates, times and flight codes stay exactly as typed.
  sh.getRange(2, 1, sh.getMaxRows() - 1, width).setNumberFormat('@');

  var attendance = SpreadsheetApp.newDataValidation().requireValueInList(ATTENDANCE, true).setAllowInvalid(true).build();
  var lodging = SpreadsheetApp.newDataValidation().requireValueInList(LODGING, true).setAllowInvalid(true).build();
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, COL.tagaytay, rows, 2).setDataValidation(attendance);
  sh.getRange(2, COL.n19, rows, NIGHTS.length).setDataValidation(lodging);
  sh.setColumnWidth(COL.name, 180);
  sh.hideColumns(COL.id);

  if (typeof SEED !== 'undefined' && SEED.length) {
    var seeded = SEED.map(function (p) {
      var person = clean_(p);
      person.updated = typeof p.updated === 'string' ? p.updated : '';
      person.id = newId_();
      return personToRow_(person);
    });
    sh.getRange(2, 1, seeded.length, width).setValues(seeded);
  }

  createSummary_(ss);
  // A brand-new spreadsheet comes with an empty "Sheet1"; drop it.
  ss.getSheets().forEach(function (s) {
    if (s.getName() === 'Sheet1' && s.getLastRow() === 0) ss.deleteSheet(s);
  });
  return sh;
}

function createSummary_(ss) {
  if (ss.getSheetByName(SUMMARY_NAME)) return;
  var sum = ss.insertSheet(SUMMARY_NAME);
  var ref = function (key) {
    var c = colLetter_(COL[key]);
    return "'" + SHEET_NAME + "'!" + c + '2:' + c;
  };
  var rows = [
    ['Quick totals', 'Yes', 'Maybe', 'No'],
    ['People listed', '=COUNTA(' + ref('name') + ')', '', ''],
    ['Tagaytay (Feb 21-23)'].concat(ATTENDANCE.map(function (a) { return '=COUNTIF(' + ref('tagaytay') + ',"' + a + '")'; })),
    ["Mama's birthday (Feb 25)"].concat(ATTENDANCE.map(function (a) { return '=COUNTIF(' + ref('feb25') + ',"' + a + '")'; }))
  ];
  sum.getRange(1, 1, rows.length, 4).setValues(rows);
  sum.getRange(1, 1, 1, 4).setFontWeight('bold');

  var top = rows.length + 2;
  var grid = [['Overnight by night'].concat(NIGHTS.map(function (d) { return 'Feb ' + d; }))];
  LODGING.forEach(function (opt) {
    grid.push([opt].concat(NIGHTS.map(function (d) { return '=COUNTIF(' + ref('n' + d) + ',"' + opt + '")'; })));
  });
  sum.getRange(top, 1, grid.length, NIGHTS.length + 1).setValues(grid);
  sum.getRange(top, 1, 1, NIGHTS.length + 1).setFontWeight('bold');
  sum.setColumnWidth(1, 200);
}

function readAll_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var range = sh.getRange(2, 1, last - 1, KEYS.length);
  var values = range.getDisplayValues();
  // Rows typed straight into the sheet have no ID yet; give them one so the site can edit them.
  var missing = false;
  values.forEach(function (row) {
    if (row[0].trim() && !row[COL.id - 1].trim()) {
      row[COL.id - 1] = newId_();
      missing = true;
    }
  });
  if (missing) {
    sh.getRange(2, COL.id, values.length, 1).setValues(values.map(function (r) { return [r[COL.id - 1]]; }));
  }
  return values.map(rowToPerson_).filter(function (p) { return p.name; });
}

function idColumn_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, COL.id, last - 1, 1).getDisplayValues().map(function (r) { return r[0].trim(); });
}

function writeRow_(sh, rowNumber, person) {
  if (rowNumber > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rowNumber - sh.getMaxRows());
  sh.getRange(rowNumber, 1, 1, KEYS.length).setNumberFormat('@').setValues([personToRow_(person)]);
}

function rowToPerson_(row) {
  var p = {};
  KEYS.forEach(function (k, i) { p[k] = String(row[i]).trim(); });
  return p;
}

function personToRow_(p) {
  return KEYS.map(function (k) {
    var v = p[k] || '';
    // A leading space keeps the sheet from treating input like "=..." as a formula.
    return /^[=+\-@]/.test(v) ? ' ' + v : v;
  });
}

/** Keeps only known fields, trims them and drops values outside the allowed choices. */
function clean_(input) {
  var p = {};
  KEYS.forEach(function (k) {
    var v = input[k] == null ? '' : String(input[k]).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim();
    p[k] = v.slice(0, k === 'name' || k === 'contact' ? 80 : 500);
  });
  ['tagaytay', 'feb25'].forEach(function (k) { if (ATTENDANCE.indexOf(p[k]) < 0) p[k] = ''; });
  NIGHTS.forEach(function (d) { if (LODGING.indexOf(p['n' + d]) < 0) p['n' + d] = ''; });
  ['arrDate', 'depDate'].forEach(function (k) { if (!/^(\d{4}-\d{2}-\d{2}|n\/a)$/.test(p[k])) p[k] = ''; });
  ['arrTime', 'depTime'].forEach(function (k) { if (!/^\d{2}:\d{2}$/.test(p[k])) p[k] = ''; });
  p.id = /^[a-z0-9]{1,16}$/.test(p.id) ? p.id : '';
  p.updated = '';
  return p;
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
