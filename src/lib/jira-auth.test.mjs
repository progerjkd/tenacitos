import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let moduleId = 0;

async function loadModule() {
  const source = readFileSync(path.join(__dirname, "jira-auth.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${moduleId++}`
  );
}

test("buildJiraAuthHeader base64-encodes email:token as Basic auth", async () => {
  const { buildJiraAuthHeader } = await loadModule();
  const expected = `Basic ${Buffer.from("sage@neuralops.ca:tok_abc123").toString("base64")}`;
  assert.equal(buildJiraAuthHeader("sage@neuralops.ca", "tok_abc123"), expected);
});

test("buildJiraAuthHeader produces different headers for different credentials", async () => {
  const { buildJiraAuthHeader } = await loadModule();
  const sage = buildJiraAuthHeader("sage@neuralops.ca", "tok_sage");
  const roger = buildJiraAuthHeader("roger@neuralops.ca", "tok_roger");
  assert.notEqual(sage, roger);
});
