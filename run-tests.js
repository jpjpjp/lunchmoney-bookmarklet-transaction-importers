#!/usr/bin/env node

// Runs every test/*.spec.js in its own process. Each spec installs its own
// browser globals (document, fetch, localStorage), so they cannot share one.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testDir = path.join(__dirname, "test");
const specs = fs.readdirSync(testDir).filter((f) => f.endsWith(".spec.js")).sort();

let failed = 0;

for (const spec of specs) {
  const result = spawnSync(process.execPath, [path.join(testDir, spec)], { encoding: "utf8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = result.status === 0 && !/FAILURES/.test(output);

  console.log(`${ok ? "PASS" : "FAIL"}  ${spec}`);
  if (!ok) {
    failed += 1;
    console.log(output.split("\n").map((l) => `      ${l}`).join("\n"));
  }
}

console.log(`\n${specs.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
