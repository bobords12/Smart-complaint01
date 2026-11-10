/**
 * Node module-resolution hook for the kiosk offline-sync tests.
 *
 * The kiosk sources are written for the Next bundler, which resolves two
 * things Node's ESM loader does not:
 *
 *   - extensionless relative specifiers  (`import { x } from "./config"`)
 *   - the `@/` path alias                 (`import { y } from "@/lib/…"`)
 *
 * This hook teaches Node both, using the real filesystem, so the tests
 * exercise the *actual* production modules instead of a copy. It is
 * registered by scripts/test-kiosk-offline-sync.mjs and is never loaded
 * by the application.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tried in order: bare path first, then the usual source extensions. */
const SUFFIXES = ["", ".js", ".mjs", ".ts", ".tsx", "/index.js", "/index.ts"];

function probe(base) {
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (!existsSync(candidate)) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Raced with something on disk; try the next shape.
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;

  if (specifier.startsWith("@/")) {
    base = path.join(ROOT, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    typeof context.parentURL === "string" &&
    context.parentURL.startsWith("file:")
  ) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (base) {
    const found = probe(base);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
