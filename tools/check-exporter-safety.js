#!/usr/bin/env node

// Mechanical safety checks for exporter sources.
//
// An exporter runs with full page privileges on a logged-in banking session,
// and anyone who installs one is running its author's code against their bank.
// These checks cannot prove an exporter works, but they do enforce the property
// people actually care about: that it cannot send their data anywhere.
//
// Run directly, or as part of `node tools/make-bookmarklet.js`.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SCAN_DIRS = ["exporters", "templates"];

// Blanks out comments while leaving strings, templates, and regex literals
// intact, so a URL inside a string is still seen and a URL inside a comment is
// not. A naive regex would also eat the tail of any line containing "https://".
const stripComments = (source) => {
  let out = "";
  let i = 0;
  const n = source.length;
  let prev = "";
  const REGEX_OK_BEFORE = "(,=:[!&|?{};>+-*%^~";

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") { out += " "; i += 1; }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      while (i < stop) { out += source[i] === "\n" ? "\n" : " "; i += 1; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c) break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      prev = c;
      i = j + 1;
      continue;
    }
    if (c === "/" && (prev === "" || REGEX_OK_BEFORE.includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
        else if (source[j] === "\n") break;
        j += 1;
      }
      while (j + 1 < n && /[a-z]/i.test(source[j + 1])) j += 1;
      out += source.slice(i, j + 1);
      prev = "/";
      i = j + 1;
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
};

const RULES = [
  {
    id: "absolute-url",
    // A quoted absolute URL or protocol-relative host. Exporters must use
    // same-origin relative paths; there is no reason to name another host.
    pattern: /(["'`])\s*(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^"'`]*\1/gi,
    message: "absolute URL — exporters must only use same-origin relative paths",
  },
  {
    id: "dynamic-code",
    pattern: /\b(eval\s*\(|new\s+Function\s*\(|Function\s*\(\s*["'`]|import\s*\(|document\.write\s*\()/g,
    message: "dynamic code execution",
  },
  {
    id: "script-injection",
    pattern: /createElement\s*\(\s*["'`]script["'`]\s*\)|\.(innerHTML|outerHTML)\s*=/g,
    message: "script injection or raw HTML assignment",
  },
  {
    id: "foreign-storage-key",
    pattern: /\b(localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*(["'`])((?!lm_export_)[^"'`]*)\2/g,
    message: "storage write outside the documented lm_export_* keys",
  },
  {
    id: "obfuscation",
    pattern: /[A-Za-z0-9+/]{200,}={0,2}/g,
    message: "long encoded blob — exporter source must stay readable",
  },
];

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const walk = (dir) => {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(rel);
    return entry.name.endsWith(".js") ? [rel] : [];
  });
};

const findings = [];
const files = SCAN_DIRS.flatMap(walk).sort();

for (const rel of files) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");

  // Every scanned file must at least parse. Nothing else checks the templates.
  try {
    new Function(source);
  } catch (e) {
    findings.push({ file: rel, line: 0, id: "syntax", message: `does not parse: ${e.message}` });
    continue;
  }

  // Specs legitimately eval the exporter under test, so they are parse-checked
  // only. Anything that ships to a bank page gets the full ruleset.
  if (rel.endsWith(".spec.js")) continue;

  const code = stripComments(source);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(code)) !== null) {
      findings.push({
        file: rel,
        line: lineOf(code, m.index),
        id: rule.id,
        message: `${rule.message}: ${m[0].slice(0, 60).replace(/\s+/g, " ")}`,
      });
    }
  }
}

if (findings.length) {
  console.error(`Exporter safety check failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.id}] ${f.message}`);
  }
  console.error("\nSee the Security section of CONTRIBUTING.md.");
  process.exit(1);
}

console.log(`Exporter safety check passed (${files.length} file${files.length === 1 ? "" : "s"} scanned)`);
