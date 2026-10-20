// CSV and spreadsheet utilities are dependency-free and shared with the tests.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else cell += c;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') {
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error('The result file is incomplete. Wait for the search to finish and try again.');
  row.push(cell); if (row.some(v => v !== '')) rows.push(row);
  if (!rows.length) return { fields: [], rows: [] };
  const fields = rows.shift();
  return { fields, rows: rows.map(values => Object.fromEntries(fields.map((field, i) => [field, values[i] ?? '']))) };
}
export const spreadsheetSafe = value => /^[\s]*[=+\-@\t\r]/.test(String(value ?? '')) ? "'" + value : String(value ?? '');
const delimited = (rows, fields, separator) => '\uFEFF' + [fields, ...rows.map(row => fields.map(field => spreadsheetSafe(row[field])))].map(row => row.map(v => '"' + String(v ?? '').replaceAll('"','""') + '"').join(separator)).join('\r\n');
const xml = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function columnName(index) { let name = ''; for (index++; index; index = Math.floor((index - 1)/26)) name = String.fromCharCode(65 + (index - 1)%26) + name; return name; }
function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let k=0;k<8;k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
// Store-mode ZIP keeps XLSX creation local without a CDN or external library.
function zip(files) {
  const enc = new TextEncoder(), local = [], central = []; let offset = 0, centralSize = 0;
  const u16 = (view, at, n) => view.setUint16(at,n,true), u32 = (view, at, n) => view.setUint32(at,n,true);
  for (const [path, content] of Object.entries(files)) {
    const name=enc.encode(path), data=enc.encode(content), crc=crc32(data);
    const head=new Uint8Array(30+name.length), h=new DataView(head.buffer);
    u32(h,0,0x04034b50); u16(h,4,20); u16(h,10,0); u16(h,12,33); u32(h,14,crc); u32(h,18,data.length); u32(h,22,data.length); u16(h,26,name.length); head.set(name,30);
    local.push(head,data);
    const dir=new Uint8Array(46+name.length), d=new DataView(dir.buffer);
    u32(d,0,0x02014b50); u16(d,4,20); u16(d,6,20); u16(d,14,33); u32(d,16,crc); u32(d,20,data.length); u32(d,24,data.length); u16(d,28,name.length); u32(d,42,offset); dir.set(name,46);
    central.push(dir); centralSize+=dir.length; offset+=head.length+data.length;
  }
  const end=new Uint8Array(22), e=new DataView(end.buffer); u32(e,0,0x06054b50); u16(e,8,central.length); u16(e,10,central.length); u32(e,12,centralSize); u32(e,16,offset);
  return new Blob([...local,...central,end], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function xlsx(rows, fields) {
  if (rows.length > 1048575 || fields.length > 16384) throw new Error('This dataset exceeds Excel worksheet limits. Choose CSV or JSON.');
  const sheet=[fields,...rows.map(row=>fields.map(field=>row[field] ?? ''))].map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>`<c r="${columnName(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Places" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheet}</sheetData></worksheet>`
  });
}
export function exportFile(format, rows, fields) {
  const selected=rows.map(row=>Object.fromEntries(fields.map(f=>[f,row[f] ?? ''])));
  switch(format) {
    case 'csv': return new Blob([delimited(rows,fields,',')],{type:'text/csv;charset=utf-8'});
    case 'tsv': return new Blob([delimited(rows,fields,'\t')],{type:'text/tab-separated-values;charset=utf-8'});
    case 'json': return new Blob([JSON.stringify(selected,null,2)],{type:'application/json'});
    case 'xlsx': return xlsx(rows,fields);
    case 'geojson': {
      const features=rows.flatMap((row,i)=>{
        if (!String(row.latitude ?? '').trim() || !String(row.longitude ?? '').trim()) return [];
        const lat=Number(row.latitude),lon=Number(row.longitude);
        if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return [];
        return [{type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:selected[i]}];
      });
      if (!features.length) throw new Error('No matching businesses have valid coordinates. Choose another format.');
      return new Blob([JSON.stringify({type:'FeatureCollection',features},null,2)],{type:'application/geo+json'});
    }
    default: throw new Error('Unsupported export format.');
  }
}
