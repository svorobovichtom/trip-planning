// Builds dist/ for the Worker's static assets (wrangler.jsonc -> assets.directory):
//   dist/          = web/ as is (legacy page at /)
//   dist/next/     = app/dist (React app, Vite base "/next/")
//   dist/_headers  = web/_headers + cache rules for /next/
// Run via `npm run build` (after the app build).
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const app = join(root, "app", "dist");
const out = join(root, "dist");

if (!existsSync(join(app, "index.html"))) {
  console.error("assemble: app/dist/index.html is missing, run the app build first");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(web, out, { recursive: true });
cpSync(app, join(out, "next"), { recursive: true });

const NEXT_HEADERS = `
# React app at /next/ (added by scripts/assemble.mjs)
/next/
  Cache-Control: no-cache
/next/index.html
  Cache-Control: no-cache
/next/sw.js
  Cache-Control: no-cache
/next/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
const headersPath = join(out, "_headers");
const base = existsSync(headersPath) ? readFileSync(headersPath, "utf8") : "";
writeFileSync(headersPath, base.replace(/\s*$/, "\n") + NEXT_HEADERS);

console.log("assemble: dist/ = web/ + app/dist at /next/");
