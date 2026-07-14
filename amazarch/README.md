# Amazarch

*Match Amazon orders to Monarch transactions.* Product spec: [`SPEC.md`](./SPEC.md).

**Status: M0 (skeleton).** Builds for Chrome + Firefox; detects your Monarch
web session (token bridge) and shows a "connected" pill + popup status.
No Amazon sync, matching, or writes yet — see SPEC.md §6 milestones.

## Develop

```bash
npm install
npm run build          # builds dist/chrome and dist/firefox
npm test               # vitest unit tests (pure helpers)
npm run typecheck
```

## Load it

- **Chrome:** `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* →
  pick `dist/firefox/manifest.json`. (Permanent installs need AMO signing — M5.)

Then open [app.monarch.com](https://app.monarch.com) while signed in: a
"Amazarch connected" pill appears bottom-right, and the toolbar popup shows the
detected session (token is redacted; held in `storage.session` only, never on disk).

> NOTE: amazon.com and app.monarch.com are egress-blocked in the
> Claude-Code-web environment — build/tests run there, but live verification
> must happen in a normal browser locally.

## Store-submission notes (M5, tracked early)

- Firefox `data_collection_permissions` categories in `manifest.firefox.json`
  are a first draft (`authenticationInfo`, `financialAndPaymentInfo`) —
  re-validate against AMO's current category list before submission.
- Keep builds unminified/readable; AMO requires reviewable source + lockfile.
- Listing subtitle must use "for Monarch Money" phrasing + not-affiliated
  disclaimer (SPEC.md D16/R4).
