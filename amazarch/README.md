# Amazarch

*Match Amazon orders to Monarch transactions.* Product spec: [`SPEC.md`](./SPEC.md).

**Status: M2+ (v0.8.0).** Builds for Chrome + Firefox. Working today: Monarch
session detection, Amazon order sync with configurable multi-year lookback,
charge matching, **refund matching** (full refunds auto when unique or singled
out by the card's return status; partials queue for review), verified notes +
merchant-rename writes with Undo, and auto-match settings. **Multi-account
(D11):** each Amazon account you sign into is cached separately and the matcher
runs against all of them — switch accounts on amazon.com and Sync to add your
household's other account. The injected panel is **draggable** (grab the header)
and **minimizes** to a floating chip. Not yet: splits, categorization
(see SPEC.md §6).

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
