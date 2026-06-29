import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let moduleId = 0;

async function loadSlackModule() {
  const source = readFileSync(path.join(__dirname, "slack.ts"), "utf8");
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

function slackResponse(body) {
  return {
    json: async () => body,
  };
}

test("resolveChannelId finds public channels when private channel scope is unavailable", async (t) => {
  const originalFetch = global.fetch;
  const originalToken = process.env.SLACK_BOT_TOKEN;
  const originalOpsChannel = process.env.SLACK_CHANNEL_OPS;
  const requests = [];

  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalToken;
    }
    if (originalOpsChannel === undefined) {
      delete process.env.SLACK_CHANNEL_OPS;
    } else {
      process.env.SLACK_CHANNEL_OPS = originalOpsChannel;
    }
  });

  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  delete process.env.SLACK_CHANNEL_OPS;

  global.fetch = async (url) => {
    requests.push(String(url));
    const requestUrl = new URL(String(url));
    const types = requestUrl.searchParams.get("types");

    if (types === "public_channel") {
      return slackResponse({
        ok: true,
        channels: [{ id: "COPS123", name: "ops" }],
      });
    }

    return slackResponse({
      ok: false,
      error: "missing_scope",
      needed: "groups:read",
    });
  };

  const { resolveChannelId } = await loadSlackModule();

  assert.equal(await resolveChannelId("#ops"), "COPS123");
  assert.equal(new URL(requests[0]).searchParams.get("types"), "public_channel");
});
