import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, exportFile } from './exports.mjs';

test('CSV preserves escaped quotes, embedded newlines, BOM and missing values',()=>{
  const parsed=parseCSV('\uFEFFtitle,address,phone\r\n"Cafe ""Nord""","Street, 1\nBerlin",+49123\r\nOther,Street\r\n');
  assert.deepEqual(parsed.fields,['title','address','phone']);
  assert.deepEqual(parsed.rows,[{title:'Cafe "Nord"',address:'Street, 1\nBerlin',phone:'+49123'},{title:'Other',address:'Street',phone:''}]);
});
test('empty results and unfinished quoted records are handled',()=>{
  assert.deepEqual(parseCSV(''),{fields:[],rows:[]});assert.throws(()=>parseCSV('name\n"unfinished'),/incomplete/);
});
test('CSV and TSV neutralize spreadsheet formulas and preserve Unicode',async()=>{
  const rows=[{title:'=HYPERLINK("bad")',phone:'+49123',note:' دمشق\nquoted "text"'}];
  for(const format of ['csv','tsv']){
    const text=await exportFile(format,rows,['title','phone','note']).text();
    assert.ok(text.includes("'=HYPERLINK"));assert.ok(text.includes("'+49123"));assert.ok(text.includes('دمشق'));
  }
});
test('JSON includes only selected fields and preserves original strings',async()=>{
  assert.deepEqual(JSON.parse(await exportFile('json',[{title:'=name',phone:'0123'}],['phone']).text()),[{phone:'0123'}]);
});
test('GeoJSON validates coordinates and preserves zero coordinates',async()=>{
  const rows=[{title:'Equator',latitude:'0',longitude:'20'},{title:'Invalid',latitude:'91',longitude:'0'},{title:'Blank',latitude:'',longitude:''}];
  const doc=JSON.parse(await exportFile('geojson',rows,['title']).text());
  assert.equal(doc.features.length,1);assert.deepEqual(doc.features[0].geometry.coordinates,[20,0]);assert.deepEqual(doc.features[0].properties,{title:'Equator'});
  assert.throws(()=>exportFile('geojson',[rows[1]],['title']),/valid coordinates/);
});
test('native XLSX stores formula-like text as strings and escapes XML',async()=>{
  const bytes=new Uint8Array(await exportFile('xlsx',[{title:'=SUM(1,2)',phone:'00123',note:'A&B <test>'}],['title','phone','note']).arrayBuffer());
  const view=new DataView(bytes.buffer);let offset=0;const files={};const decoder=new TextDecoder();
  while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);const start=offset+30;const name=decoder.decode(bytes.slice(start,start+nameLength));const dataStart=start+nameLength+extra;files[name]=decoder.decode(bytes.slice(dataStart,dataStart+size));offset=dataStart+size;}
  assert.equal(Object.keys(files).length,5);assert.ok(files['xl/worksheets/sheet1.xml'].includes('t="inlineStr"'));assert.ok(files['xl/worksheets/sheet1.xml'].includes('=SUM(1,2)'));assert.ok(files['xl/worksheets/sheet1.xml'].includes('00123'));assert.ok(files['xl/worksheets/sheet1.xml'].includes('A&amp;B &lt;test&gt;'));assert.ok(!files['xl/worksheets/sheet1.xml'].includes('<f>'));
});
