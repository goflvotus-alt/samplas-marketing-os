import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

test("server wiring: MCP is off by default and only dynamically imported when MCP_ENABLED=on", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const mcpEnabled = env\.MCP_ENABLED === "on";/);
  assert.doesNotMatch(server, /^import .*scripts\/mcp\//m, "no static import of the MCP module");
  assert.match(server, /import\("\.\/scripts\/mcp\/mcp-route\.mjs"\)/);
  assert.match(server, /if \(mcpEnabled && \(url\.pathname === "\/mcp" \|\| url\.pathname\.startsWith\("\/\.well-known\/oauth-protected-resource"\)\)\) \{/);
  const render = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
  for (const key of ["MCP_ENABLED", "MCP_RESOURCE_URL", "OAUTH_ISSUER", "MCP_ALLOWED_SUBJECTS"]) {
    assert.match(render, new RegExp(`- key: ${key}\\n\\s+sync: false`), key);
  }
});

test("MCP module safety: no writes, no shell, no non-GET upstream calls", async () => {
  const dir = new URL("../scripts/mcp/", import.meta.url);
  for (const file of await readdir(dir)) {
    const source = await readFile(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/, file);
    assert.doesNotMatch(source, /node:child_process|writeFile|appendFile|rename\(|unlink\(|rm\(/, file);
    assert.doesNotMatch(source, /samplas\.(propose|apply)/, file);
  }
});

test("MCP runtime does not load the MCP SDK or a schema library (memory gate)", async () => {
  const dir = new URL("../scripts/mcp/", import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f !== "smoke.mjs")) {
    const source = await readFile(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /from "(@modelcontextprotocol\/|zod|ajv|hono)/, file);
  }
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["exceljs", "jose"]);
});
