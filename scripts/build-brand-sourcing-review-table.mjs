import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeBrandKey } from "./brand-engine.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  reviewQueue: resolve(root, "work/brand-sourcing-review-queue.json"),
  universe: resolve(root, "work/brand-universe.json"),
  brandMaster: resolve(root, "work/brand-master.json"),
  xlsb: resolve(root, "input/SAMPLAS 데스크 할인율 07.30.xlsb"),
  json: resolve(root, "work/brand-sourcing-representative-review.json"),
  csv: resolve(root, "work/brand-sourcing-representative-review.csv"),
  markdown: resolve(root, "work/brand-sourcing-representative-review.md")
};
const sourcingTypes = new Map([
  ["사입", "WHOLESALE"],
  ["위탁", "CONSIGNMENT"],
  ["하이브리드", "HYBRID"],
  ["제작", "OWN_PRODUCTION"]
]);
const confidenceRank = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
const fields = [
  "universe_brand_code", "universe_brand_name", "universe_status",
  "xlsb_source_brand_name", "xlsb_source_row", "sourcing_type",
  "normalized_universe_name", "normalized_xlsb_name",
  "suggested_brand_code", "suggested_brand_name", "suggestion_basis",
  "confidence", "review_status", "representative_decision", "representative_note"
];
const text = (value) => String(value ?? "").trim();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const normalized = (value) => normalizeBrandKey(value)
  .replace(/&/g, "and")
  .replace(/[^\p{L}\p{N}]+/gu, "");
const tokens = (value) => normalizeBrandKey(value)
  .replace(/&/g, " and ")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

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
    print(json.dumps({'sheet':'할인율','rows':rows},ensure_ascii=False))
`;

async function readSourcingRows() {
  const temp = await mkdtemp(join(tmpdir(), "samplas-sourcing-review-"));
  try {
    await execFile(process.env.SOFFICE_BIN || "soffice", ["--headless", "--convert-to", "xlsx", "--outdir", temp, paths.xlsb], { timeout: 60000 });
    const xlsx = (await readdir(temp)).find((name) => name.endsWith(".xlsx"));
    if (!xlsx) throw new Error("LibreOffice did not create an XLSX file");
    const { stdout } = await execFile(process.env.PYTHON_BIN || "python3", ["-c", pythonParser, join(temp, xlsx)], { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function editSimilarity(left, right) {
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function tokenSimilarity(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

function findSuggestions(brand, sourceRows) {
  const canonical = text(brand.brand_name);
  const aliases = Array.isArray(brand.name_aliases) ? brand.name_aliases.map(text).filter(Boolean) : [];
  const canonicalNormalized = normalized(canonical);
  const aliasKeys = new Set(aliases.map(normalized).filter(Boolean));
  const ranked = [];
  for (const source of sourceRows) {
    const sourceKey = normalized(source.name);
    let basis = "NO_CANDIDATE";
    let confidence = "NONE";
    let score = 0;
    if (sourceKey && sourceKey === canonicalNormalized) {
      basis = "EXACT_NORMALIZED";
      confidence = "HIGH";
      score = 1;
    } else if (sourceKey && aliasKeys.has(sourceKey)) {
      basis = "EXISTING_ALIAS";
      confidence = "HIGH";
      score = 1;
    } else {
      const tokenScore = Math.max(tokenSimilarity(canonical, source.name), ...aliases.map((alias) => tokenSimilarity(alias, source.name)), 0);
      const nameScore = Math.max(editSimilarity(canonicalNormalized, sourceKey), ...aliases.map((alias) => editSimilarity(normalized(alias), sourceKey)), 0);
      if (tokenScore >= 0.67) {
        basis = "TOKEN_SIMILARITY";
        confidence = "MEDIUM";
        score = tokenScore;
      } else if (nameScore >= 0.78) {
        basis = "NAME_SIMILARITY";
        confidence = "MEDIUM";
        score = nameScore;
      } else if (nameScore >= 0.68 || (tokenScore >= 0.5 && Math.max(tokens(canonical).length, tokens(source.name).length) >= 2)) {
        basis = tokenScore >= nameScore ? "TOKEN_SIMILARITY" : "NAME_SIMILARITY";
        confidence = "LOW";
        score = Math.max(tokenScore, nameScore);
      }
    }
    if (confidence !== "NONE") ranked.push({ ...source, basis, confidence, score });
  }
  ranked.sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence] || right.score - left.score || compareText(left.name, right.name));
  if (!ranked.length) return { selected: null, alternatives: [], basis: "NO_CANDIDATE", confidence: "NONE" };
  const best = ranked[0];
  const alternatives = ranked.filter((item) => confidenceRank[item.confidence] === confidenceRank[best.confidence] && best.score - item.score < 0.04).slice(0, 5);
  if (alternatives.length > 1) return { selected: null, alternatives, basis: "MANUAL_REVIEW_REQUIRED", confidence: best.confidence };
  return { selected: best, alternatives: ranked.slice(1, 5), basis: best.basis, confidence: best.confidence };
}

const csvCell = (value) => {
  const raw = String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};
const markdownCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const reviewQueue = await readJson(paths.reviewQueue);
const universe = await readJson(paths.universe);
const masterFile = await readJson(paths.brandMaster);
const master = Array.isArray(masterFile) ? masterFile : masterFile?.brands;
if (!Array.isArray(reviewQueue) || reviewQueue.length !== 31) throw new Error("Expected 31 review queue brands");
if (!Array.isArray(universe) || universe.length !== 44 || !Array.isArray(master)) throw new Error("Expected Brand Universe and Brand Master");

const parsed = await readSourcingRows();
const sourceRowsByName = new Map();
for (const row of parsed.rows.filter((item) => item.row >= 5 && sourcingTypes.has(text(item.B)))) {
  const name = text(row.A);
  if (!name) continue;
  const existing = sourceRowsByName.get(name);
  const source = { name, row: row.row, sourcing_type: sourcingTypes.get(text(row.B)) };
  if (!existing || source.row < existing.row) sourceRowsByName.set(name, source);
}
const sourceRows = [...sourceRowsByName.values()].sort((left, right) => compareText(left.name, right.name));
const universeByCode = new Map(universe.map((item) => [text(item.brand_code), item]));
const masterByCode = new Map(master.map((item) => [text(item.brand_code), item]));
const queueCodes = new Set(reviewQueue.map((item) => text(item.brand_code)));
if (queueCodes.size !== reviewQueue.length) throw new Error("Duplicate brand_code in review queue");

const output = reviewQueue.map((queueItem) => {
  const code = text(queueItem.brand_code);
  const universeItem = universeByCode.get(code);
  const brand = masterByCode.get(code);
  if (!universeItem || !brand) throw new Error(`Missing Universe or Brand Master entry: ${code}`);
  const suggestion = findSuggestions(brand, sourceRows);
  const selected = suggestion.selected;
  return {
    universe_brand_code: code,
    universe_brand_name: text(brand.brand_name),
    universe_status: text(universeItem.review_status),
    xlsb_source_brand_name: selected?.name || "",
    xlsb_source_row: selected?.row ?? null,
    sourcing_type: selected?.sourcing_type || "",
    normalized_universe_name: normalized(brand.brand_name),
    normalized_xlsb_name: selected ? normalized(selected.name) : "",
    suggested_brand_code: selected ? code : "",
    suggested_brand_name: selected ? text(brand.brand_name) : "",
    suggestion_basis: suggestion.basis,
    confidence: suggestion.confidence,
    review_status: "PENDING",
    representative_decision: "",
    representative_note: "",
    suggested_candidates: suggestion.alternatives.map((item) => ({
      xlsb_source_brand_name: item.name,
      xlsb_source_row: item.row,
      sourcing_type: item.sourcing_type,
      suggestion_basis: item.basis,
      confidence: item.confidence,
      similarity: Number(item.score.toFixed(4))
    }))
  };
});

output.sort((left, right) => confidenceRank[left.confidence] - confidenceRank[right.confidence]
  || compareText(left.universe_brand_name, right.universe_brand_name)
  || compareText(left.xlsb_source_brand_name, right.xlsb_source_brand_name));
if (output.length !== reviewQueue.length || new Set(output.map((item) => item.universe_brand_code)).size !== output.length) throw new Error("Review output completeness failed");
if (output.some((item) => !queueCodes.has(item.universe_brand_code) || item.review_status !== "PENDING" || item.representative_decision || item.representative_note)) throw new Error("Review output policy failed");

const csv = `\uFEFF${fields.join(",")}\n${output.map((item) => fields.map((field) => csvCell(item[field])).join(",")).join("\n")}\n`;
const decisionGuide = "CONNECT_EXISTING · NEW_BRAND_CANDIDATE · SOURCE_NAME_ERROR · HOLD · REJECT";
const markdown = [
  "# Brand Sourcing Representative Review",
  "",
  `Decision enum: ${decisionGuide}`,
  "",
  "> Suggestions are review aids only. No row is automatically approved or connected.",
  "",
  `| ${fields.join(" | ")} |`,
  `| ${fields.map(() => "---").join(" | ")} |`,
  ...output.map((item) => `| ${fields.map((field) => markdownCell(item[field])).join(" | ")} |`),
  ""
].join("\n");

await writeFile(paths.json, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await writeFile(paths.csv, csv, "utf8");
await writeFile(paths.markdown, markdown, "utf8");

const countBy = (items, key) => Object.fromEntries(items.reduce((counts, item) => counts.set(item[key], (counts.get(item[key]) || 0) + 1), new Map()));
console.log(JSON.stringify({
  sheet: parsed.sheet,
  reviewCount: reviewQueue.length,
  outputCount: output.length,
  xlsbSourceBrands: sourceRows.length,
  confidence: countBy(output, "confidence"),
  suggestionBasis: countBy(output, "suggestion_basis")
}, null, 2));
