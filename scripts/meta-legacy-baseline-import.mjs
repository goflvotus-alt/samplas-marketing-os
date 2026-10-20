// Registers an already-delivered Meta weekly workbook as the issued baseline for its period.
// The Dropbox source is only read (downloaded beforehand); this script never contacts Dropbox.
//
// Dry-run (default, writes nothing):
//   node scripts/meta-legacy-baseline-import.mjs --file <xlsx> --dropbox-id id:... \
//     --dropbox-path "/SAMPLAS WORK/..." --server-modified 2026-10-13T03:24:35Z \
//     [--dropbox-content-hash <hex from Dropbox metadata>] [--dropbox-rev <rev>]
// Register (separate approval required for Production /var/data):
//   ... --write --output-dir <META_ADS_WEEKLY_REPORT_DIR>
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { extractLegacyMetaBaseline, legacyBaselineRecord, storeLegacyMetaBaseline } from "./meta-issued-report.mjs";

export async function importLegacyMetaBaseline({ file, source, write = false, outputDir, now = () => new Date() }) {
  const bytes = await readFile(file);
  const extracted = await extractLegacyMetaBaseline(bytes);
  const record = legacyBaselineRecord({ extracted, bytes, source, importedAt: now().toISOString() });
  if (!write) return { mode: "dry-run", record };
  if (!outputDir) throw new Error("--output-dir is required with --write");
  const stored = await storeLegacyMetaBaseline({ outputDir, bytes, record });
  return { mode: "write", record, manifestPath: stored.manifestPath };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { values } = parseArgs({ options: {
    file: { type: "string" }, "dropbox-id": { type: "string" }, "dropbox-path": { type: "string" },
    "dropbox-rev": { type: "string" }, "dropbox-content-hash": { type: "string" }, "server-modified": { type: "string" },
    write: { type: "boolean", default: false }, "output-dir": { type: "string" }
  } });
  try {
    const result = await importLegacyMetaBaseline({
      file: values.file,
      source: { dropboxFileId: values["dropbox-id"], dropboxPath: values["dropbox-path"], dropboxRev: values["dropbox-rev"], dropboxContentHash: values["dropbox-content-hash"], serverModified: values["server-modified"] },
      write: values.write,
      outputDir: values["output-dir"]
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`LEGACY_IMPORT_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
