import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const frontend = await readFile(new URL("../outputs/samplas-marketing-os.js", import.meta.url), "utf8");
const importer = await readFile(new URL("../scripts/import-ecount-offline-sales.mjs", import.meta.url), "utf8");

test("Production ECOUNT import requires an operator session or existing internal authorization", () => {
  assert.match(server, /if \(!isAuthorizedEcountImport\(req\)\)/);
  assert.match(server, /samplas_operator=.*HttpOnly; SameSite=Strict/);
  assert.match(server, /new URL\(origin\)\.host/);
});

test("operator credentials are entered at runtime and no secret is embedded in frontend source", () => {
  assert.match(frontend, /authorizeEcountProductionUpload/);
  assert.match(frontend, /Production 업로드 권한을 확인할 수 없습니다/);
  assert.doesNotMatch(frontend, /CAFE24_PROXY_SECRET|CAFE24_PROXY_BASIC_AUTH|x-samplas-internal-token/);
});

test("Production upload always parses the workbook and rejects filename/content month mismatch before write", () => {
  assert.match(server, /force: true/);
  assert.match(importer, /options\.expectedMonth && month !== options\.expectedMonth/);
  assert.match(importer, /buildWarehouseRoutedSnapshots\(loaded, month, filePath\)/);
  assert.match(importer, /writeJsonSetAtomic\(entries, options\.atomicFs\)/);
});

test("upload UI describes direct current-environment application, not Local-only sync", () => {
  const region = frontend.slice(frontend.indexOf("function ecountWizardModalNode"), frontend.indexOf("function ecountWizardMonthFromFileName"));
  assert.match(region, /현재 운영 환경에 즉시 반영됩니다/);
  assert.doesNotMatch(region, /로컬 Marketing OS|Render 운영 배포는 별도/);
});
