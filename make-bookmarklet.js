#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = __dirname;

// The version of this project as a whole. Every exporter that stamps
// `source_version` into custom_metadata must agree with it; the build fails
// otherwise, so a bumped version cannot be half-applied.
const PROJECT_VERSION = "2.0.0";

// Every supported institution is declared once here. Loader storage keys,
// generated bookmarklet filenames, and the reset bookmarklets are all derived
// from this list, so adding an institution means adding one entry.
const EXPORTERS = [
  { id: "cfna", label: "CFNA Exporter", source: "cfna-exporter.js" },
  { id: "sofi", label: "SoFi Exporter", source: "sofi-exporter.js" },
];

const IMPORTER = { key: "lm_bookmarklet_lm_importer_src", label: "Lunch Money Importer", source: "lm-importer.js" };

const exporterKey = (id) => `lm_bookmarklet_${id}_exporter_src`;
const outName = (source, suffix) => `${source.replace(/\.js$/, "")}${suffix}`;

// Settings the importer persists. Account ids are stored per institution and
// account, so they are matched by prefix rather than exact name.
const SETTING_EXACT_KEYS = ["lm_import_token", "lm_import_api_base"];
const SETTING_PREFIX_KEYS = ["lm_import_v1_account_id", "lm_import_v2_manual_account_id", "lm_export_selected_account"];

/**
 * Collapse JavaScript to a single line for use in a `javascript:` URL.
 *
 * This walks the source instead of running regexes over it. A naive
 * `.replace(/\/\/.*$/gm, "")` also strips the tail of any line containing a URL
 * such as "https://api.lunchmoney.dev/v2", which silently corrupted every
 * generated bookmarklet that contained one.
 */
const minify = (source) => {
  let out = "";
  let i = 0;
  const n = source.length;

  // Tracks the last meaningful character emitted, used to tell a regex literal
  // apart from a division operator.
  let prevSignificant = "";
  const REGEX_ALLOWED_BEFORE = "(,=:[!&|?{};>+-*%^~";

  const atLineCommentEnd = (j) => {
    while (j < n && source[j] !== "\n") j += 1;
    return j;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // Comments are dropped entirely.
    if (c === "/" && next === "/") {
      i = atLineCommentEnd(i);
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    // Quoted strings are copied verbatim; their contents are never touched.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c) break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      prevSignificant = c;
      i = j + 1;
      continue;
    }

    // Template literals may contain real newlines, which cannot survive in a
    // one-line URL, so those become escape sequences instead of being lost.
    if (c === "`") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === "`") break;
        j += 1;
      }
      out += source.slice(i, j + 1).replace(/\r?\n/g, "\\n");
      prevSignificant = "`";
      i = j + 1;
      continue;
    }

    // Regex literal, but only where a regex can legally start.
    if (c === "/" && (prevSignificant === "" || REGEX_ALLOWED_BEFORE.includes(prevSignificant))) {
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
      prevSignificant = "/";
      i = j + 1;
      continue;
    }

    // Whitespace outside strings collapses to a single space.
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(source[j])) j += 1;
      if (out && !out.endsWith(" ")) out += " ";
      i = j;
      continue;
    }

    out += c;
    prevSignificant = c;
    i += 1;
  }

  return out.trim();
};

const toBookmarklet = (source) => `javascript:${minify(source)}`;

const loaderSource = ({ storageKey, displayName, expectedFileName }) => `(() => {
  const key = "${storageKey}";
  const name = "${displayName}";

  const runScript = (script) => {
    try {
      (0, eval)(script);
    } catch (e) {
      console.error("[loader] script failed", e);
      alert(name + " failed: " + (e && e.message ? e.message : e));
    }
  };

  const existing = localStorage.getItem(key);
  if (existing) {
    runScript(existing);
    return;
  }

  const shouldLoad = confirm(
    "Install ${displayName} in this browser now?\\n\\n" +
      "Click OK to choose the local .js file.\\n" +
      "Expected file: ${expectedFileName}\\n\\n" +
      "If no file picker appears, click this bookmark again once."
  );
  if (!shouldLoad) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".js,text/javascript";
  input.style.position = "fixed";
  input.style.left = "-9999px";

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) {
      input.remove();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const script = String(reader.result || "");
      localStorage.setItem(key, script);
      input.remove();
      alert(name + " installed. Running now.");
      runScript(script);
    };
    reader.onerror = () => {
      input.remove();
      alert("Failed to read selected file.");
    };
    reader.readAsText(file);
  });

  document.body.appendChild(input);
  input.click();
})();`;

const allLoaderKeys = [...EXPORTERS.map((e) => exporterKey(e.id)), IMPORTER.key];

const resetLoaderSource = `(() => {
  ${JSON.stringify(allLoaderKeys)}.forEach((k) => localStorage.removeItem(k));
  alert("Cleared loader cache for: ${[...EXPORTERS.map((e) => e.label), IMPORTER.label].join(", ")}.");
})();`;

const resetImportSettingsSource = `(() => {
  const exact = ${JSON.stringify(SETTING_EXACT_KEYS)};
  const prefixes = ${JSON.stringify(SETTING_PREFIX_KEYS)};
  const doomed = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (exact.indexOf(k) !== -1 || prefixes.some((p) => k === p || k.indexOf(p + "__") === 0)) doomed.push(k);
  }
  doomed.forEach((k) => localStorage.removeItem(k));
  alert("Cleared " + doomed.length + " saved LM setting(s): credentials, account ids, and export account choices.");
})();`;

const writeBookmarklet = (source, outFile) => {
  const bookmarklet = toBookmarklet(source);

  // A bookmarklet that does not parse is worse than no bookmarklet, so fail the
  // build rather than write a broken file.
  try {
    new Function(bookmarklet.replace(/^javascript:/, ""));
  } catch (e) {
    throw new Error(`Generated ${outFile} does not parse: ${e.message}`);
  }

  const outPath = path.join(root, outFile);
  fs.writeFileSync(outPath, bookmarklet + "\n");
  console.log(`Wrote ${outFile} (length ${bookmarklet.length})`);
};

const checkVersion = (sourceFile) => {
  const source = fs.readFileSync(path.join(root, sourceFile), "utf8");
  const match = source.match(/const SOURCE_VERSION = "([^"]+)"/);
  if (!match) return; // Exporters that emit no metadata do not declare one.
  if (match[1] !== PROJECT_VERSION) {
    throw new Error(
      `${sourceFile} declares SOURCE_VERSION "${match[1]}" but PROJECT_VERSION is "${PROJECT_VERSION}".`
    );
  }
};

const buildFromFile = (sourceFile, outFile) =>
  writeBookmarklet(fs.readFileSync(path.join(root, sourceFile), "utf8"), outFile);

for (const exporter of EXPORTERS) {
  checkVersion(exporter.source);
  buildFromFile(exporter.source, outName(exporter.source, ".bookmarklet.txt"));
  writeBookmarklet(
    loaderSource({
      storageKey: exporterKey(exporter.id),
      displayName: exporter.label,
      expectedFileName: exporter.source,
    }),
    outName(exporter.source, ".loader.bookmarklet.txt")
  );
}

buildFromFile(IMPORTER.source, outName(IMPORTER.source, ".bookmarklet.txt"));
writeBookmarklet(
  loaderSource({ storageKey: IMPORTER.key, displayName: IMPORTER.label, expectedFileName: IMPORTER.source }),
  outName(IMPORTER.source, ".loader.bookmarklet.txt")
);

writeBookmarklet(resetLoaderSource, "loader-reset.bookmarklet.txt");
writeBookmarklet(resetImportSettingsSource, "import-settings-reset.bookmarklet.txt");

console.log(`\nBuilt lm-bookmarklets v${PROJECT_VERSION}`);
