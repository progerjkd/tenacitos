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

test("parses root and OpenClaw data mount points from findmnt output", () => {
  const { parseFindmntDisks } = loadTypeScriptModule(path.join(__dirname, "system-disks.ts"));
  const output = [
    "SOURCE TARGET FSTYPE SIZE USED AVAIL USE%",
    "/dev/nvme0n1p1 / ext4 6.7G 5.8G 919.4M 86%",
    "/dev/nvme0n1p1[/docker/containers/id/resolv.conf] /etc/resolv.conf ext4 6.7G 5.8G 919.4M 86%",
    "tmpfs /run tmpfs 366.9M 1.3M 365.6M 0%",
    "/dev/nvme1n1 /opt/openclaw-data ext4 29.4G 20G 8.2G 68%",
  ].join("\n");

  assert.deepEqual(parseFindmntDisks(output), [
    {
      source: "/dev/nvme0n1p1",
      mountpoint: "/",
      fstype: "ext4",
      total: 6.7,
      used: 5.8,
      free: 0.9,
      percent: 86,
    },
    {
      source: "/dev/nvme1n1",
      mountpoint: "/opt/openclaw-data",
      fstype: "ext4",
      total: 29.4,
      used: 20,
      free: 8.2,
      percent: 68,
    },
  ]);
});

test("groups bind-mounted paths from the same backing disk into one tile", () => {
  const { groupDiskEntries } = loadTypeScriptModule(path.join(__dirname, "system-disks.ts"));

  assert.deepEqual(
    groupDiskEntries([
      {
        source: "/dev/root",
        mountpoint: "/",
        fstype: "ext4",
        total: 6.7,
        used: 5.8,
        free: 0.9,
        percent: 87,
      },
      {
        source: "/dev/nvme1n1",
        mountpoint: "/opt/openclaw-data",
        fstype: "ext4",
        total: 29.4,
        used: 20.7,
        free: 8.7,
        percent: 70,
      },
      {
        source: "/dev/nvme1n1[/config]",
        mountpoint: "/opt/openclaw-data/config",
        fstype: "ext4",
        total: 29.4,
        used: 20.7,
        free: 8.7,
        percent: 70,
      },
      {
        source: "/dev/nvme1n1[/workspace]",
        mountpoint: "/opt/openclaw-data/workspace",
        fstype: "ext4",
        total: 29.4,
        used: 20.7,
        free: 8.7,
        percent: 70,
      },
    ]),
    [
      {
        source: "/dev/root",
        mountpoint: "/",
        mountpoints: ["/"],
        fstype: "ext4",
        total: 6.7,
        used: 5.8,
        free: 0.9,
        percent: 87,
      },
      {
        source: "/dev/nvme1n1",
        mountpoint: "/opt/openclaw-data",
        mountpoints: [
          "/opt/openclaw-data",
          "/opt/openclaw-data/config",
          "/opt/openclaw-data/workspace",
        ],
        fstype: "ext4",
        total: 29.4,
        used: 20.7,
        free: 8.7,
        percent: 70,
      },
    ]
  );
});

test("parses df filesystem rows without bind-mounted subpaths", () => {
  const { parseDfDisks } = loadTypeScriptModule(path.join(__dirname, "system-disks.ts"));
  const output = [
    "Filesystem Type Size Used Avail Use% Mounted on",
    "/dev/root ext4 6.8G 5.8G 918M 87% /",
    "/dev/nvme1n1 ext4 30G 21G 7.4G 74% /opt/openclaw-data",
    "/dev/nvme1n1[/config] ext4 30G 21G 7.4G 74% /opt/openclaw-data/config",
    "/dev/nvme1n1[/workspace] ext4 30G 21G 7.4G 74% /opt/openclaw-data/workspace",
  ].join("\n");

  assert.deepEqual(parseDfDisks(output), [
    {
      source: "/dev/root",
      mountpoint: "/",
      fstype: "ext4",
      total: 6.8,
      used: 5.8,
      free: 0.9,
      percent: 87,
    },
    {
      source: "/dev/nvme1n1",
      mountpoint: "/opt/openclaw-data",
      fstype: "ext4",
      total: 30,
      used: 21,
      free: 7.4,
      percent: 74,
    },
  ]);
});

test("prefers df filesystem rows over findmnt bind mount targets", () => {
  const { selectSystemDisks } = loadTypeScriptModule(path.join(__dirname, "system-disks.ts"));
  const dfOutput = [
    "Filesystem Type Size Used Avail Use% Mounted on",
    "/dev/root ext4 6.8G 5.8G 918M 87% /",
    "/dev/nvme1n1 ext4 30G 21G 7.4G 74% /opt/openclaw-data",
  ].join("\n");
  const findmntOutput = [
    "SOURCE TARGET FSTYPE SIZE USED AVAIL USE%",
    "/dev/nvme1n1[/config] /opt/openclaw-data/config ext4 29.4G 20.8G 7.4G 71%",
    "/dev/nvme1n1[/workspace] /opt/openclaw-data/workspace ext4 29.4G 20.8G 7.4G 71%",
  ].join("\n");

  assert.deepEqual(selectSystemDisks({ dfOutput, findmntOutput }), [
    {
      source: "/dev/root",
      mountpoint: "/",
      fstype: "ext4",
      total: 6.8,
      used: 5.8,
      free: 0.9,
      percent: 87,
    },
    {
      source: "/dev/nvme1n1",
      mountpoint: "/opt/openclaw-data",
      fstype: "ext4",
      total: 30,
      used: 21,
      free: 7.4,
      percent: 74,
    },
  ]);
});
