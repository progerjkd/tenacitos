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

test("formats a disk with explicit device, filesystem, and mount point", () => {
  const { getDiskDisplayDetails } = loadTypeScriptModule(
    path.join(__dirname, "system-monitor-display.ts")
  );

  assert.deepEqual(
    getDiskDisplayDetails({
      source: "/dev/nvme1n1",
      fstype: "ext4",
      mountpoint: "/opt/openclaw-data",
    }),
    {
      device: "/dev/nvme1n1",
      filesystem: "ext4",
      mountpoint: "/opt/openclaw-data",
    }
  );
});

test("normalizes missing swap metrics to an empty usage bar", () => {
  const { getSwapDisplay } = loadTypeScriptModule(
    path.join(__dirname, "system-monitor-display.ts")
  );

  assert.deepEqual(getSwapDisplay(), {
    total: 0,
    used: 0,
    free: 0,
    percent: 0,
  });
});
