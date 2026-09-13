// Refreshes the vendored copy of the Mindmap.io OpenAPI document that the MCP
// tool list is generated from (server/spec/openapi.json).
//
//   npm run sync:openapi
//
// Drift is checkable in one line, the same way the skills index is:
//
//   npm run sync:openapi && git diff --exit-code server/spec
//
// Fetches the PUBLISHED document, deliberately not a sibling local checkout of
// the mindmap repo. A local clone can hold unpushed edits, and generating from
// those would ship a tool list describing a contract nobody can reach — the
// same reasoning as marketing/scripts/sync-agent-skills.mjs.
//
// It refuses to write a document whose operations are missing their `x-mcp`
// annotations. A tool with no title and no readOnly/destructive hint is a
// rejection criterion for both Anthropic directories, so a silent fallback
// would quietly ship the unannotated list this replaces. Until the annotated
// spec is deployed this exits 1 and the vendored copy stands.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readOperations } from "../dist/openapi.js";

const DEFAULT_BASE_URL = "https://mindmap.io";
const baseUrl = (process.argv[2] ?? process.env.MINDMAP_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const source = `${baseUrl}/api/openapi.json`;
const destination = join(dirname(fileURLToPath(import.meta.url)), "..", "spec", "openapi.json");

const response = await fetch(source);
if (!response.ok) {
  console.error(`${source} returned HTTP ${response.status}`);
  process.exit(1);
}
const spec = await response.json();

let operations;
try {
  operations = readOperations(spec);
} catch (error) {
  console.error(`${source} is not ready to generate MCP tools from.\n`);
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\nThe vendored copy was left untouched.");
  process.exit(1);
}

const serialised = `${JSON.stringify(spec, null, 2)}\n`;
let previous = null;
try {
  previous = readFileSync(destination, "utf8");
} catch {
  // First sync.
}

writeFileSync(destination, serialised);
console.log(
  `${previous === serialised ? "Already current" : "Updated"}: ${destination} ` +
    `(${operations.size} annotated operations from ${source})`,
);
