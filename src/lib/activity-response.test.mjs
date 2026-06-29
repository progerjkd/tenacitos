import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loadedModule = { exports: {} };
  new Function("exports", "module", output)(loadedModule.exports, loadedModule);
  return loadedModule.exports;
}

test("normalizes failed activities responses to an empty page", () => {
  const { normalizeActivitiesResponse } = loadTypeScriptModule(path.join(__dirname, "activity-response.ts"));

  assert.deepEqual(normalizeActivitiesResponse({ error: "Failed to get activities" }, 20, 0), {
    activities: [],
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });
});

test("normalizes failed activity stats responses to iterable empty collections", () => {
  const { normalizeActivityStats } = loadTypeScriptModule(path.join(__dirname, "activity-response.ts"));

  assert.deepEqual(normalizeActivityStats({ error: "Failed to get stats" }), {
    total: 0,
    today: 0,
    heatmap: [],
    byType: {},
    byStatus: {},
    trend: [],
    hourly: [],
  });
});
