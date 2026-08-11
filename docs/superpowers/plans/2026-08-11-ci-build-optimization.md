# CI Build Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace emulated ARM64 compilation with a cached native ARM64 Next.js build and reduce unnecessary workflow latency.

**Architecture:** GitHub Actions builds Next.js directly on a native ARM64 runner, persists `.next/cache`, and packages standalone output with a minimal runtime Dockerfile. The existing Dockerfile remains the self-contained local-build path.

**Tech Stack:** GitHub Actions, Node.js 24, Next.js 16, Docker Buildx, Node test runner

## Global Constraints

- The published image remains `linux/arm64`.
- Application runtime behavior and deployment commands remain unchanged.
- The existing self-contained `Dockerfile` remains usable.
- CI changes are covered by a source-level regression test.

---

### Task 1: Lock the workflow contract with a failing test

**Files:**
- Create: `src/lib/ci-build-workflow.test.mjs`

**Interfaces:**
- Consumes: `.github/workflows/deploy.yml`, `.dockerignore`, `Dockerfile.runtime`, and `Dockerfile.runtime.dockerignore`
- Produces: regression coverage for the optimized CI contract

- [x] **Step 1: Write assertions for native ARM, direct Next build caching, parallel jobs, PR cancellation, path filters, and runtime packaging.**
- [x] **Step 2: Run `node --test src/lib/ci-build-workflow.test.mjs` and verify it fails because the optimized configuration is absent.**

### Task 2: Implement the optimized build pipeline

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.dockerignore`
- Create: `Dockerfile.runtime`
- Create: `Dockerfile.runtime.dockerignore`

**Interfaces:**
- Consumes: Node 24 project build scripts and Next.js standalone output
- Produces: native ARM64 CI build and a minimal production image

- [x] **Step 1: Add PR-only concurrency cancellation and an in-job Markdown-only short circuit that preserves required checks.**
- [x] **Step 2: Move the build job to `ubuntu-24.04-arm`, remove QEMU and the lint dependency, and add Node/npm plus `.next/cache` restoration.**
- [x] **Step 3: Run `npm ci` and `npm run build` on the native runner before Docker packaging, and make deployment wait for both parallel required checks.**
- [x] **Step 4: Add the runtime-only Dockerfile and its allow-list context.**
- [x] **Step 5: Tighten the self-contained Docker context without excluding runtime source.**
- [x] **Step 6: Run the focused regression test and verify it passes.**

### Task 3: Validate and publish

**Files:**
- Verify all files changed by Tasks 1 and 2

**Interfaces:**
- Consumes: completed workflow and packaging changes
- Produces: validated draft pull request with measured Actions results

- [x] **Step 1: Run `npm test`, `npm run lint`, and `node_modules/.bin/tsc --noEmit`.**
- [x] **Step 2: Run `npm run build` and validate runtime Docker packaging locally where supported.**
- [x] **Step 3: Inspect workflow syntax, `git diff --check`, and the complete focused diff.**
- [ ] **Step 4: Commit, push `agent/optimize-ci-build`, and open a draft PR against `main`.**
- [ ] **Step 5: Monitor the PR checks and report the measured build time or any concrete platform blocker.**
