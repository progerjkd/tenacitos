# CI Build Optimization Design

## Goal

Reduce TenacitOS pull-request and deployment pipeline time without weakening the production ARM64 image check or changing application runtime behavior.

## Design

The build job will run on GitHub's native `ubuntu-24.04-arm` runner, eliminating QEMU from the CPU-heavy Next.js compilation path. Next.js will build directly on the runner with Node 24, and `actions/cache` will persist `.next/cache` across source changes. A dedicated `Dockerfile.runtime` will package the already-built standalone output; the existing self-contained `Dockerfile` remains available for local builds.

The lint job and build job will run concurrently. Both remain required checks, while deployment continues to depend only on the successfully built production image. Pull-request concurrency will cancel superseded runs, and Markdown-only changes will not trigger this build-and-deploy workflow.

Docker contexts will exclude generated output and test-only files for the self-contained Dockerfile. The CI runtime Dockerfile will use a Dockerfile-specific allow-list so it receives only the standalone output, static assets, public assets, and seed data.

## Safety and validation

- Preserve `linux/arm64` as the produced and tested image architecture.
- Preserve the existing Node 24 and Next.js standalone runtime.
- Keep GitHub Actions cache keys architecture- and lockfile-specific, with source hashes for exact cache entries and a lockfile restore prefix for incremental rebuilds.
- Add a source-level regression test that checks the workflow, runtime Dockerfile, and ignore rules.
- Run the complete Node test suite, ESLint, TypeScript, a production Next.js build, workflow syntax checks, and an ARM64 Docker packaging build where the local engine permits it.
- Publish as a draft PR and use its Actions timings as the final verification of native ARM runner availability and performance.

## Expected result

The approximately four-minute emulated compilation and type-check segment should fall materially on native ARM hardware. Direct `.next/cache` persistence should improve subsequent builds, while parallel jobs and cancellation reduce wall-clock latency and wasted runner time.
