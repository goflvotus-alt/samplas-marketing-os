import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeBrandKey } from "./brand-engine.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  xlsb: resolve(root, "input/SAMPLAS 데스크 할인율 07.30.xlsb"),
  brandMaster: resolve(root, "work/brand-master.json"),
  universe: resolve(root, "work/brand-universe.json"),
  candidates: resolve(root, "work/brand-sourcing-candidates.json"),
  reviewQueue: resolve(root, "work/brand-sourcing-review-queue.json")
};
const sourcingTypes = new Map([
  ["사입", "WHOLESALE"],
  ["위탁", "CONSIGNMENT"],
  ["하이브리드", "HYBRID"],
  ["제작", "OWN_PRODUCTION"]
]);
const matchPriority = { exact_brand_code: 0, exact_brand_name: 1, exact_alias: 2 };
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const text = (value) => String(value ?? "").trim();
const exactKey = (value) => normalizeBrandKey(value).replace(/[^\p{L}\p{N}]+/gu, "");

const pythonParser = String.raw`
import json, sys, zipfile
from xml.etree import ElementTree as ET
path=sys.argv[1]
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','p':'http://schemas.openxmlformats.org/package/2006/relationships'}
with zipfile.ZipFile(path) as z:
    shared=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        root=ET.fromstring(z.read('xl/sharedStrings.xml'))
        shared=[''.join(t.text or '' for t in si.findall('.//m:t',ns)) for si in root.findall('m:si',ns)]
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rel=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    targets={x.attrib['Id']:x.attrib['Target'] for x in rel.findall('p:Relationship',ns)}
    sheets=[]
    for sheet in wb.findall('m:sheets/m:sheet',ns):
        target=targets[sheet.attrib['{'+ns['r']+'}id']]
        target='xl/'+target.lstrip('/') if not target.startswith('xl/') else target
        sheets.append((sheet.attrib['name'],target))
    target=next((item for item in sheets if item[0]=='할인율'),None)
    if target is None:
        raise SystemExit('missing 할인율 sheet')
    def value(cell):
        kind=cell.attrib.get('t')
        if kind=='inlineStr':
            return ''.join(t.text or '' for t in cell.findall('.//m:t',ns))
        node=cell.find('m:v',ns)
        if node is None:
            return ''
        raw=node.text or ''
        return shared[int(raw)] if kind=='s' else raw
    root=ET.fromstring(z.read(target[1]))
    rows=[]
    for row in root.findall('.//m:sheetData/m:row',ns):
        number=row.attrib['r']
        cells={cell.attrib['r']:value(cell) for cell in row.findall('m:c',ns)}
        rows.append({'row':int(number),'A':cells.get('A'+number,''),'B':cells.get('B'+number,'')})
    print(json.dumps({'sheets':[item[0] for item in sheets],'rows':rows},ensure_ascii=False))
`;

function addIndex(index, value, code) {
  const key = exactKey(value);
  if (!key) return;
  const codes = index.get(key) || new Set();
  codes.add(code);
  index.set(key, codes);
}

async function readSourcingRows() {
  const temp = await mkdtemp(join(tmpdir(), "samplas-sourcing-"));
  try {
    const soffice = process.env.SOFFICE_BIN || "soffice";
    await execFile(soffice, ["--headless", "--convert-to", "xlsx", "--outdir", temp, paths.xlsb], { timeout: 60000 });
    const xlsx = (await readdir(temp)).find((name) => name.endsWith(".xlsx"));
    if (!xlsx) throw new Error("LibreOffice did not create an XLSX file");
    const { stdout } = await execFile(process.env.PYTHON_BIN || "python3", ["-c", pythonParser, join(temp, xlsx)], { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const brandMaster = await readJson(paths.brandMaster);
const brands = Array.isArray(brandMaster) ? brandMaster : brandMaster?.brands;
const universe = await readJson(paths.universe);
if (!Array.isArray(brands) || !Array.isArray(universe) || universe.length !== 44) throw new Error("Expected Brand Master and a 44-brand Universe");

const universeCodes = new Set(universe.map((item) => text(item?.brand_code)));
const masterByCode = new Map(brands.filter((item) => universeCodes.has(text(item?.brand_code))).map((item) => [text(item.brand_code), item]));
if (masterByCode.size !== universe.length) throw new Error("Every Universe brand must exist in Brand Master");

const codeIndex = new Map();
const nameIndex = new Map();
const aliasIndex = new Map();
for (const [code, brand] of masterByCode) {
  addIndex(codeIndex, code, code);
  addIndex(nameIndex, brand?.brand_name, code);
  for (const alias of Array.isArray(brand?.name_aliases) ? brand.name_aliases : []) addIndex(aliasIndex, alias, code);
}

const parsed = await readSourcingRows();
if (!parsed.sheets.includes("할인율")) throw new Error("The 할인율 sheet is required");
const dataRows = parsed.rows.filter((row) => row.row >= 5);
const validRows = dataRows.filter((row) => sourcingTypes.has(text(row.B)));
const instructionRows = dataRows.filter((row) => text(row.A) && !sourcingTypes.has(text(row.B)));
const rowsByRawName = new Map();
for (const row of validRows) {
  const rawName = text(row.A);
  const rows = rowsByRawName.get(rawName) || [];
  rows.push(row);
  rowsByRawName.set(rawName, rows);
}

const matchesByCode = new Map([...universeCodes].map((code) => [code, []]));
const ambiguousByCode = new Map([...universeCodes].map((code) => [code, []]));
for (const row of validRows) {
  const key = exactKey(row.A);
  const choices = [
    ["exact_brand_code", codeIndex.get(key)],
    ["exact_brand_name", nameIndex.get(key)],
    ["exact_alias", aliasIndex.get(key)]
  ];
  const [matchType, codeSet] = choices.find(([, codes]) => codes?.size) || [];
  if (!codeSet) continue;
  const codes = [...codeSet];
  if (codes.length > 1) {
    for (const code of codes) ambiguousByCode.get(code).push(row);
    continue;
  }
  matchesByCode.get(codes[0]).push({ row, matchType, sourcingType: sourcingTypes.get(text(row.B)) });
}

const candidates = [];
const reviews = [];
for (const item of universe) {
  const code = text(item.brand_code);
  const brand = masterByCode.get(code);
  const evidence = { brand_name: text(brand?.brand_name), name_aliases: Array.isArray(brand?.name_aliases) ? brand.name_aliases : [] };
  const ambiguous = ambiguousByCode.get(code);
  const matches = matchesByCode.get(code);
  let reason = null;
  if (ambiguous.length) reason = "ambiguous_exact_match";
  else if (!matches.length) reason = "xlsb_no_match";
  else if (new Set(matches.map((match) => match.sourcingType)).size > 1) reason = "duplicate_source_conflict";

  if (reason) {
    reviews.push({
      brand_code: code,
      canonical_brand: text(brand?.brand_name),
      universe_status: item.review_status,
      candidate_xlsb_names: [...new Set([...ambiguous, ...matches.map((match) => match.row)].map((row) => text(row.A)))].sort(),
      reason,
      evidence
    });
    continue;
  }

  const selected = [...matches].sort((left, right) => matchPriority[left.matchType] - matchPriority[right.matchType] || left.row.row - right.row.row)[0];
  candidates.push({
    brand_code: code,
    canonical_brand: text(brand?.brand_name),
    xlsb_brand_name_raw: text(selected.row.A),
    sourcing_type: selected.sourcingType,
    match_type: selected.matchType,
    review_status: "candidate",
    source: { file: basename(paths.xlsb), sheet: "할인율", row: selected.row.row }
  });
}

candidates.sort((left, right) => left.brand_code.localeCompare(right.brand_code));
reviews.sort((left, right) => left.reason.localeCompare(right.reason) || left.brand_code.localeCompare(right.brand_code));
await writeFile(paths.candidates, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
await writeFile(paths.reviewQueue, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");

const countBy = (items, key) => Object.fromEntries([...items.reduce((counts, item) => {
  const value = item[key];
  counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}, new Map())]);
console.log(JSON.stringify({
  sheets: parsed.sheets,
  headerRow: 4,
  dataStartRow: 5,
  validSourcingRows: validRows.length,
  uniqueXlsbBrands: rowsByRawName.size,
  duplicateXlsbBrands: [...rowsByRawName].filter(([, rows]) => rows.length > 1).map(([brandName, rows]) => ({ brandName, rows: rows.map((row) => row.row), sourcingTypes: [...new Set(rows.map((row) => text(row.B)))] })),
  excludedInstructionRows: instructionRows.length,
  universeCount: universe.length,
  candidateCount: candidates.length,
  reviewCount: reviews.length,
  matchTypes: countBy(candidates, "match_type"),
  sourcingTypes: countBy(candidates, "sourcing_type"),
  reviewReasons: countBy(reviews, "reason")
}, null, 2));
