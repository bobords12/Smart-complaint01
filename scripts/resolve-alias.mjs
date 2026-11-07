// Node module-resolution shim so plain `node` scripts can import project
// modules that use the Next.js "@/" path alias (and extensionless specifiers).
// Registered at runtime by the driver scripts via `module.register()`; it is
// never loaded by the app itself.
//
//   node scripts/drive-reklamo.mjs   (which calls register("./resolve-alias.mjs"))
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"];

function fileOrNull(base) {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveTarget(specifier) {
  const base = path.join(ROOT, specifier.slice(2));
  return fileOrNull(base) ?? fileOrNull(path.join(base, "index"));
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolveTarget(specifier);
    if (target) return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}