# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project uses Conventional Commits.

## [Unreleased]

### Added

- Added a Vercel free-tier `/ghc/*` Function path with HTTP cache headers and optional Runtime Cache probing.
- Added Deploy to Cloudflare and Deploy with Vercel README badges.
- Added Cloudflare and Vercel free-tier deployment documentation.

### Changed

- Reworked Cloudflare API token deployment docs to use current dashboard/API permission names in tables, and documented `CLOUDFLARE_ACCOUNT_ID` for GitHub Actions deploys.

### Fixed

- Skip the Worker deploy step when `CLOUDFLARE_API_TOKEN` is not configured, while still running install, type-check, and tests.
- Clarified where to configure `GITHUB_TOKEN` for Cloudflare and Vercel deployments, and separated it from the GitHub Actions `CLOUDFLARE_API_TOKEN`.

## [0.1.0] - 2026-05-18

### Added

- Initial Cloudflare Worker for KIRARI GitHub card caching.
- Repository, contents, commits, avatar, and health endpoints.
- L1 Cache API plus L2 KV stale fallback strategy.
- Optional GitHub token support.
- Optional Origin allowlist.
- Optional cron prewarm targets.
- KIRARI integration, deployment, and operations documentation.
- Private Service Binding deployment mode with `workers_dev = false`.
- GitHub Actions CI and Worker deployment workflows.
- Chinese README, deployment, integration, and operations documentation.
