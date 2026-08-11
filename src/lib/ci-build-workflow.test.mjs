import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("builds and packages Next.js natively on ARM with an incremental cache", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");

  assert.match(workflow, /build:\n[\s\S]*?runs-on: ubuntu-24\.04-arm/);
  assert.doesNotMatch(workflow, /docker\/setup-qemu-action/);
  assert.doesNotMatch(workflow, /build:\n[\s\S]*?needs: lint/);
  assert.match(workflow, /actions\/cache@v6/);
  assert.match(workflow, /path: \.next\/cache/);
  assert.match(workflow, /runner\.arch/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run build/);
  assert.match(workflow, /file: Dockerfile\.runtime/);
  assert.match(workflow, /platforms: linux\/arm64/);
});

test("cancels superseded pull requests and short-circuits Markdown-only builds", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");

  assert.match(workflow, /cancel-in-progress:.*github\.event_name == 'pull_request'/);
  assert.doesNotMatch(workflow, /paths-ignore:/);
  assert.match(workflow, /name: Detect application changes/);
  assert.match(workflow, /:\(exclude\)\*\*\/\*\.md/);
  assert.match(workflow, /if: steps\.changes\.outputs\.app == 'true'/);
  assert.match(workflow, /needs: \[lint, build\]/);
  assert.match(workflow, /needs\.build\.outputs\.changed == 'true'/);
});

test("packages only prebuilt standalone runtime artifacts", () => {
  const runtimeDockerfilePath = path.join(repoRoot, "Dockerfile.runtime");
  assert.equal(fs.existsSync(runtimeDockerfilePath), true, "Dockerfile.runtime must exist");

  const runtimeDockerfile = fs.readFileSync(runtimeDockerfilePath, "utf8");
  assert.match(runtimeDockerfile, /FROM node:24-bookworm-slim/);
  assert.match(runtimeDockerfile, /COPY --chown=nextjs:nodejs \.next\/standalone/);
  assert.match(runtimeDockerfile, /COPY --chown=nextjs:nodejs \.next\/static/);
  assert.doesNotMatch(runtimeDockerfile, /npm (ci|run build)/);

  const runtimeIgnore = readRepoFile("Dockerfile.runtime.dockerignore");
  assert.match(runtimeIgnore, /^\*$/m);
  assert.match(runtimeIgnore, /^!\.next\/standalone\/\*\*$/m);
  assert.match(runtimeIgnore, /^!\.next\/static\/\*\*$/m);

  const defaultIgnore = readRepoFile(".dockerignore");
  assert.match(defaultIgnore, /^\.next$/m);
  assert.match(defaultIgnore, /^\*\*\/\*\.test\.mjs$/m);
});
