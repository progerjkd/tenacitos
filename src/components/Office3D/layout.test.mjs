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

const layout = loadTypeScriptModule(path.join(__dirname, "layout.ts"));

test("computeDeskLayout places every agent collision-free inside the room", () => {
  for (let count = 1; count <= 16; count++) {
    const placements = layout.computeDeskLayout(count);
    assert.equal(placements.length, count, `expected ${count} placements`);

    for (const { position } of placements) {
      const dist = Math.hypot(position[0], position[2]);
      assert.ok(
        dist <= layout.ROOM_RADIUS - 2,
        `desk at ${position} escapes the room (count=${count})`,
      );
      assert.equal(position[1], 0, "desks sit on the floor");
    }

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = placements[i].position;
        const b = placements[j].position;
        const gap = Math.hypot(a[0] - b[0], a[2] - b[2]);
        assert.ok(gap >= 2.5, `desks ${i} and ${j} overlap (gap=${gap.toFixed(2)}, count=${count})`);
      }
    }
  }
});

test("computeDeskLayout orients every desk toward the central core", () => {
  for (const count of [1, 2, 6, 12]) {
    for (const { position, rotationY } of layout.computeDeskLayout(count)) {
      const forward = [Math.sin(rotationY), Math.cos(rotationY)];
      const len = Math.hypot(position[0], position[2]);
      const toCore = [-position[0] / len, -position[2] / len];
      const dot = forward[0] * toCore[0] + forward[1] * toCore[1];
      assert.ok(dot > 0.999, `desk at ${position} looks away from the core (dot=${dot})`);
    }
  }
});

test("computeDeskLayout handles empty rosters", () => {
  assert.deepEqual(layout.computeDeskLayout(0), []);
  assert.deepEqual(layout.computeDeskLayout(-3), []);
});

test("agentActivity derives the visual state from live fields", () => {
  assert.equal(layout.agentActivity({ status: "online", activeSessions: 2 }), "working");
  assert.equal(layout.agentActivity({ status: "offline", isActive: true }), "working");
  assert.equal(layout.agentActivity({ status: "online", activeSessions: 0 }), "online");
  assert.equal(layout.agentActivity({ status: "offline" }), "offline");
});

test("every activity has a visual definition", () => {
  for (const activity of ["working", "online", "offline"]) {
    assert.ok(layout.ACTIVITY_VISUALS[activity], `missing visual for ${activity}`);
  }
});

test("groupIssues buckets every issue into a board column", () => {
  const issue = (id, status) => ({
    id,
    key: `NEURALOPS-${id}`,
    summary: "s",
    status,
    priority: "Medium",
    issuetype: "Task",
    assignee: null,
    url: "https://example.invalid",
  });

  const issues = [
    issue("1", "To Do"),
    issue("2", "In Progress"),
    issue("3", "Done"),
    issue("4", "Closed"),
    issue("5", "In Review"),
    issue("6", "Backlog"),
  ];
  const grouped = layout.groupIssues(issues);

  assert.deepEqual(grouped["To Do"].map((i) => i.id), ["1", "6"]);
  assert.deepEqual(grouped["In Progress"].map((i) => i.id), ["2", "5"]);
  assert.deepEqual(grouped["Done"].map((i) => i.id), ["3", "4"]);

  const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);
  assert.equal(total, issues.length, "no issue may vanish from the hologram");
});

test("truncate keeps short strings and ellipsizes long ones", () => {
  assert.equal(layout.truncate("short", 10), "short");
  const long = layout.truncate("a".repeat(50), 10);
  assert.equal(long.length, 10);
  assert.ok(long.endsWith("…"));
});
