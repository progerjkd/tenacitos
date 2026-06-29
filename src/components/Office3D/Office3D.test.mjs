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

test("Office3D defines initial state for every configured agent", () => {
  const { AGENTS } = loadTypeScriptModule(path.join(__dirname, "agentsConfig.ts"));
  const source = fs.readFileSync(path.join(__dirname, "Office3D.tsx"), "utf8");

  const initialStateMatch = source.match(
    /useState<Record<string,\s*AgentState>>\(\{([\s\S]*?)\n\s*\}\);/
  );
  assert.ok(initialStateMatch, "Office3D should define an initial agentStates map");

  const stateKeys = new Set(
    [...initialStateMatch[1].matchAll(/^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:/gm)]
      .map((match) => match[2] || match[3])
  );

  const missing = AGENTS.map((agent) => agent.id).filter((id) => !stateKeys.has(id));
  assert.deepEqual(missing, [], `missing initial state for: ${missing.join(", ")}`);
});
