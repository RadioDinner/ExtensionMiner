// Amazarch build: bundles the extension for chrome and/or firefox into dist/<target>/.
// Usage: node build.mjs [chrome|firefox]   (no arg = both)
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const TARGETS = process.argv[2] ? [process.argv[2]] : ["chrome", "firefox"];

const ENTRIES = {
  "background.js": "src/background/index.ts",
  "monarch-content.js": "src/content/monarch/index.ts",
  "amazon-content.js": "src/content/amazon/index.ts",
  "popup.js": "src/popup/popup.ts",
  "onboarding.js": "src/onboarding/onboarding.ts",
};

const HTML = {
  "popup.html": "src/popup/popup.html",
  "onboarding.html": "src/onboarding/onboarding.html",
};

for (const target of TARGETS) {
  if (!["chrome", "firefox"].includes(target)) {
    console.error(`Unknown target "${target}" — expected chrome or firefox`);
    process.exit(1);
  }
  const outdir = `dist/${target}`;
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  for (const [outfile, entry] of Object.entries(ENTRIES)) {
    await build({
      entryPoints: [entry],
      outfile: `${outdir}/${outfile}`,
      bundle: true,
      // iife: MV3 content scripts (and Firefox background.scripts) are classic scripts.
      format: "iife",
      platform: "browser",
      target: "es2022",
      sourcemap: false,
      minify: false,
      define: { __BROWSER__: JSON.stringify(target) },
    });
  }

  await cp(`manifest.${target}.json`, `${outdir}/manifest.json`);
  for (const [outfile, src] of Object.entries(HTML)) await cp(src, `${outdir}/${outfile}`);
  console.log(`built ${outdir}`);
}
