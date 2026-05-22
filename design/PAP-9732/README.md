# PAP-9732 — UX review evidence

Plan: [PAP-9721](/PAP/issues/PAP-9721#document-plan)
Implementation: [PAP-9728](/PAP/issues/PAP-9728), [PAP-9729](/PAP/issues/PAP-9729), [PAP-9730](/PAP/issues/PAP-9730)
Reviewer: UXDesigner

## How these screenshots were produced

1. The EE plugin UI bundle from `packages/plugins/paperclip-ee-permissions/dist/ui/index.js` was copied verbatim into `ee-plugin.mjs`.
2. `sdk-mock.mjs` provides drop-in implementations of `useHostContext`, `usePluginData`, and `usePluginAction` keyed off a per-root context, so each rendered card represents the production component reacting to one deterministic state.
3. `states.mjs` defines a state per acceptance-criteria scenario (missing company, loading, unlicensed, populated, pending join, capability-denied warning, generic backend warning, fetch error, deny preview, empty).
4. `capture.mjs` boots a tiny static server, drives Chromium via the in-tree Playwright (`node_modules/.pnpm/playwright@1.58.2`), and screenshots each section twice — 1440×900 desktop and 390×844 mobile (deviceScaleFactor 2).
5. Run with `node design/PAP-9732/capture.mjs` (sandbox must be disabled for Chromium to start).

The mocked host hooks return the exact data shapes the worker emits (`EePermissionsOverview`, `EePermissionsMemberAccessData`, `EePermissionsAdvancedPolicyData`), so the screenshots show the same DOM the production runtime would render given the same payload.

## Screenshots

Stored under `./screenshots/`, named `{state-index}-{state}-{viewport}.png`.

| State | Desktop | Mobile |
| --- | --- | --- |
| Missing company | `01-missing-company-desktop.png` | `01-missing-company-mobile.png` |
| Loading | `02-loading-desktop.png` | `02-loading-mobile.png` |
| Unlicensed / activate | `03-unlicensed-desktop.png` | `03-unlicensed-mobile.png` |
| Activated — empty | `04-empty-desktop.png` | `04-empty-mobile.png` |
| Activated — populated | `05-populated-desktop.png` | `05-populated-mobile.png` |
| Activated — pending join | `06-pending-join-desktop.png` | `06-pending-join-mobile.png` |
| Capability-denied warning | `07-denied-desktop.png` | `07-denied-mobile.png` |
| Generic backend warning (stale) | `08-stale-desktop.png` | `08-stale-mobile.png` |
| Overview fetch error | `09-error-desktop.png` | `09-error-mobile.png` |
| Policy preview deny | `10-deny-desktop.png` | `10-deny-mobile.png` |
