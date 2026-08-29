#!/usr/bin/env node

// Runs every test/*.spec.js in its own process. Each spec installs its own
// browser globals (document, fetch, localStorage), so they cannot share one.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Specs live beside the code they exercise: one per exporter, one for the
// importer. Anything matching *.spec.js under these roots is picked up.
const root = path.join(__dirname, "..");
const searchRoots = [path.join(root, "exporters"), path.join(root, "importer")];

const findSpecs = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findSpecs(full);
    return entry.name.endsWith(".spec.js") ? [full] : [];
  });
};

const specs = searchRoots.flatMap(findSpecs).sort();

let failed = 0;

for (const spec of specs) {
  const label = path.relative(root, spec);
  const result = spawnSync(process.execPath, [spec], { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = result.status === 0 && !/FAILURES/.test(output);

  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failed += 1;
    console.log(output.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

console.log(`\n${specs.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
