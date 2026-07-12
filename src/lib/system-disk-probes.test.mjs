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

test("maps container disk probes to their host mount points", () => {
  const { remapSystemDiskMountpoint } = loadTypeScriptModule(
    path.join(__dirname, "system-disk-probes.ts")
  );

  assert.deepEqual(
    remapSystemDiskMountpoint(
      { source: "/dev/root", mountpoint: "/host-root-probe", total: 6.8, used: 5.9, free: 0.9, percent: 87 },
      [
        { path: "/host-root-probe", mountpoint: "/" },
        { path: "/opt/openclaw-data/config", mountpoint: "/opt/openclaw-data" },
      ]
    ),
    { source: "/dev/root", mountpoint: "/", total: 6.8, used: 5.9, free: 0.9, percent: 87 }
  );

  assert.equal(
    remapSystemDiskMountpoint(
      { source: "/dev/nvme1n1", mountpoint: "/opt/openclaw-data/config", total: 30, used: 28, free: 0.3, percent: 99 },
      [{ path: "/opt/openclaw-data/config", mountpoint: "/opt/openclaw-data" }]
    ).mountpoint,
    "/opt/openclaw-data"
  );
});
