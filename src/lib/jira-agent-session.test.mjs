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

function loadModule() {
  return loadTypeScriptModule(path.join(__dirname, "jira-agent-session.ts"));
}

test("sessionKeyForTicket builds one session key per ticket", () => {
  const { sessionKeyForTicket } = loadModule();
  assert.equal(sessionKeyForTicket("sage", "NEURALOPS-24"), "agent:sage:NEURALOPS-24");
  assert.equal(sessionKeyForTicket("playsmith", "NEURALOPS-7"), "agent:playsmith:NEURALOPS-7");
});

test("decideCommentRelay skips the bot's own status comments", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "In Progress",
    commentBody: "🤖 Sent to sage for triage and assignment.\nAuto-dispatched via TenacitOS Mission Control.",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay skips comments on tickets that haven't been dispatched yet", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "To Do",
    commentBody: "any human comment",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay skips empty comment bodies", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-24",
    issueStatus: "In Progress",
    commentBody: "",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, { relay: false });
});

test("decideCommentRelay relays a human reply on a ticket already in progress", () => {
  const { decideCommentRelay } = loadModule();
  const decision = decideCommentRelay({
    issueKey: "NEURALOPS-23",
    issueStatus: "In Progress",
    commentBody: "1. AWS, adjust IAM as required. 2. neuralops-dev.",
    agentSlug: "sage",
  });
  assert.deepEqual(decision, {
    relay: true,
    sessionKey: "agent:sage:NEURALOPS-23",
    message: "Roger replied on NEURALOPS-23: 1. AWS, adjust IAM as required. 2. neuralops-dev.",
  });
});
