import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The MCP tool metadata each operation carries in the OpenAPI document, under
 * an `x-mcp` extension. The two hints are stated per operation rather than
 * derived from the HTTP method, which is the wrong signal for several of them:
 * `POST /publish` writes without destroying anything, `DELETE /publish` is
 * reversible because the public id is retained, and the generative `POST`s
 * spend real money while deleting nothing.
 */
export interface McpAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

/** One documented operation, flattened out of the paths object. */
export interface OperationDoc extends McpAnnotations {
  operationId: string;
  method: string;
  path: string;
  /** The operation's own prose. This is what a model reads before calling it. */
  description: string;
}

/** The vendored copy of the published document, alongside the compiled output. */
const SPEC_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "spec", "openapi.json");

/**
 * Read the vendored OpenAPI document — a mirror of what
 * `https://mindmap.io/api/openapi.json` serves, refreshed by
 * `npm run sync:openapi`. Reading a vendored file rather than fetching keeps
 * the tool list identical offline, on every start, and in tests.
 */
export function loadSpec(): unknown {
  return JSON.parse(readFileSync(SPEC_PATH, "utf8"));
}

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head", "trace"];

/**
 * Flatten an OpenAPI document into its operations, keyed by `operationId`.
 *
 * Throws when any operation is missing a complete `x-mcp` block. That is
 * deliberate and load-bearing: emitting a tool with no title and no hints is
 * a rejection criterion for both Anthropic directories, and a silent fallback
 * would ship exactly the unannotated tool list this replaces.
 */
export function readOperations(spec: unknown): Map<string, OperationDoc> {
  const paths = (spec as { paths?: Record<string, Record<string, any>> } | null)?.paths;
  if (!paths || typeof paths !== "object") {
    throw new Error("OpenAPI document has no paths object.");
  }

  const operations = new Map<string, OperationDoc>();
  const problems: string[] = [];

  for (const [path, item] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!HTTP_METHODS.includes(method) || !operation || typeof operation !== "object") continue;
      const operationId = (operation as any).operationId;
      if (typeof operationId !== "string") {
        problems.push(`${method.toUpperCase()} ${path}: no operationId`);
        continue;
      }

      const description = normalise((operation as any).description ?? (operation as any).summary);
      if (!description) {
        problems.push(`${operationId}: no description`);
      }

      const annotations = readAnnotations((operation as any)["x-mcp"], operationId, problems);
      if (!annotations || !description) continue;

      operations.set(operationId, {
        operationId,
        method: method.toUpperCase(),
        path,
        description,
        ...annotations,
      });
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The OpenAPI document is not ready to generate MCP tools from:\n  ${problems.join("\n  ")}\n` +
        "Every operation needs an x-mcp block with title, readOnlyHint and destructiveHint. " +
        "Refresh the vendored copy with `npm run sync:openapi` once the annotated spec is deployed.",
    );
  }

  return operations;
}

function readAnnotations(raw: unknown, operationId: string, problems: string[]): McpAnnotations | null {
  if (!raw || typeof raw !== "object") {
    problems.push(`${operationId}: no x-mcp block`);
    return null;
  }
  const block = raw as Record<string, unknown>;
  const missing = [
    typeof block.title === "string" && block.title.length > 0 ? null : "title",
    typeof block.readOnlyHint === "boolean" ? null : "readOnlyHint",
    typeof block.destructiveHint === "boolean" ? null : "destructiveHint",
  ].filter((field): field is string => field !== null);

  if (missing.length > 0) {
    problems.push(`${operationId}: x-mcp is missing ${missing.join(", ")}`);
    return null;
  }

  return {
    title: block.title as string,
    readOnlyHint: block.readOnlyHint as boolean,
    destructiveHint: block.destructiveHint as boolean,
  };
}

/** Collapse YAML folded-scalar wrapping into paragraphs a model reads cleanly. */
function normalise(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}
