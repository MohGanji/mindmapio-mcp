import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The MCP tool metadata each operation carries in the OpenAPI document, under
 * an `x-mcp` extension. The three hints are stated per operation rather than
 * derived from the HTTP method, which is the wrong signal for several of them:
 * `POST /publish` writes without destroying anything, `DELETE /publish` is
 * reversible because the public id is retained, and the generative `POST`s
 * spend real money while deleting nothing.
 *
 * `openWorldHint` is about REACH, and it is the one OpenAI's tool scan rejects
 * a submission for omitting. Thirteen of the seventeen operations touch nothing
 * but the caller's own rows and mindmap.io's own object storage, which is not
 * an open world for being externally hosted. Four are: submit and retry bind a
 * web-search tool, so one call can read arbitrary public pages, and publish and
 * unpublish put a map's content on, and take it off, a URL anyone can fetch.
 */
export interface McpAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

/**
 * One documented operation, flattened out of the paths object.
 *
 * The annotations are held NESTED rather than spread flat, which is the one
 * thing standing between this and a repeat of #622: a flat shape has to be
 * picked apart key by key where the tool list is assembled, and that second
 * list was a second place for a hint to go missing. Held whole, it travels
 * whole — `readAnnotations` below is the only code that names a hint.
 */
export interface OperationDoc {
  operationId: string;
  method: string;
  path: string;
  /** The operation's own prose. This is what a model reads before calling it. */
  description: string;
  annotations: McpAnnotations;
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
 * a rejection criterion for both Anthropic directories and an automated
 * rejection on an OpenAI submission, and a silent fallback would ship exactly
 * the unannotated tool list this replaces.
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
        annotations,
      });
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The OpenAPI document is not ready to generate MCP tools from:\n  ${problems.join("\n  ")}\n` +
        "Every operation needs an x-mcp block with title, readOnlyHint, destructiveHint and openWorldHint. " +
        "Refresh the vendored copy with `npm run sync:openapi` once the annotated spec is deployed.",
    );
  }

  return operations;
}

/**
 * Every annotation a tool ships, and how to recognise a stated one. ONE list:
 * it is both what each operation must state and the whole of what reaches a
 * client, so the two cannot drift apart the way they did for `openWorldHint`.
 */
const ANNOTATIONS: Record<keyof McpAnnotations, (value: unknown) => boolean> = {
  title: (value) => typeof value === "string" && value.length > 0,
  readOnlyHint: (value) => typeof value === "boolean",
  destructiveHint: (value) => typeof value === "boolean",
  openWorldHint: (value) => typeof value === "boolean",
};

function readAnnotations(raw: unknown, operationId: string, problems: string[]): McpAnnotations | null {
  if (!raw || typeof raw !== "object") {
    problems.push(`${operationId}: no x-mcp block`);
    return null;
  }
  const block = raw as Record<string, unknown>;

  const missing = Object.entries(ANNOTATIONS)
    .filter(([key, isStated]) => !isStated(block[key]))
    .map(([key]) => key);
  if (missing.length > 0) {
    problems.push(`${operationId}: x-mcp is missing ${missing.join(", ")}`);
    return null;
  }

  // An annotation the document states and this server does not emit is a hint
  // dropped between a reviewed contract and the `tools/list` a client reads —
  // which is exactly how `openWorldHint` went missing for a release (#622). So
  // it is a refusal naming the key, never a quiet omission.
  const unknown = Object.keys(block).filter((key) => !(key in ANNOTATIONS));
  if (unknown.length > 0) {
    problems.push(
      `${operationId}: x-mcp declares ${unknown.join(", ")}, which this server does not emit — ` +
        "name it in ANNOTATIONS (server/src/openapi.ts) or stop declaring it upstream",
    );
    return null;
  }

  return Object.fromEntries(
    Object.keys(ANNOTATIONS).map((key) => [key, block[key]]),
  ) as unknown as McpAnnotations;
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
