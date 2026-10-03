import { describe, expect, it } from "vitest";
import { loadSpec } from "../src/openapi.js";
import { buildTools } from "../src/tools.js";

/**
 * The annotation leg of the parity invariant (#622, mindmap.io).
 *
 * `tools.test.ts` checks that each tool HAS a title and hints. That is not the
 * same statement, and the difference is a bug that shipped: `openWorldHint` —
 * the third hint OpenAI's tool scan hard-gates on — was written into the
 * OpenAPI document and reached no client at all, because `readAnnotations`
 * rebuilt the annotation object from a fixed list of three keys. A per-tool
 * check of the three keys it did emit stayed green through the whole thing.
 *
 * So the rule here is about the JOIN, not about a known list: the annotation
 * object a tool ships carries exactly the keys the document declares for its
 * operation. It fails in both directions, and both are real failures:
 *
 *   a key in the document, not in the tool — dropped on the way out; name it
 *     in `ANNOTATIONS`, or stop declaring it upstream
 *   a key in the tool, not in the document — invented here, so nobody
 *     reviewing the contract ever saw it
 *
 * Every rule takes the spec as an argument so it can be shown to BITE against
 * a doctored document. A passing parity suite says nothing about what it would
 * have caught; that was the lesson of the round before this one.
 */

/** The `x-mcp` block each operation of the vendored document declares. */
function declaredAnnotations(spec: any): Map<string, Record<string, unknown>> {
  const blocks = new Map<string, Record<string, unknown>>();
  for (const item of Object.values<any>(spec.paths ?? {})) {
    for (const operation of Object.values<any>(item ?? {})) {
      if (operation?.operationId) blocks.set(operation.operationId, operation["x-mcp"]);
    }
  }
  return blocks;
}

/** A deep copy of the vendored document, safe to doctor one operation of. */
function doctorableSpec(): any {
  return structuredClone(loadSpec());
}

/** The raw `x-mcp` block of one operation inside a (copied) spec. */
function annotationBlockIn(spec: any, operationId: string): Record<string, unknown> {
  const block = declaredAnnotations(spec).get(operationId);
  if (!block) throw new Error(`${operationId} has no x-mcp block — this fixture is stale.`);
  return block;
}

describe("the tool list's annotations carry what the document declares", () => {
  it("emits exactly the x-mcp keys each operation declares, dropping none of them", () => {
    const declared = declaredAnnotations(loadSpec());
    const disagreements: string[] = [];

    for (const tool of buildTools()) {
      const expected = Object.keys(declared.get(tool.operationId) ?? {}).sort();
      const emitted = Object.keys(tool.annotations).sort();
      if (emitted.join(",") !== expected.join(",")) {
        disagreements.push(`${tool.name}: document declares [${expected}], tool ships [${emitted}]`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  it("refuses a document that declares an annotation this server does not emit", () => {
    // The rule above only bites if the generator NOTICES the key. A reader that
    // quietly ignores what it does not recognise turns the next hint into this
    // bug again: declared upstream, reviewed, vendored, never shipped.
    const spec = doctorableSpec();
    annotationBlockIn(spec, "submitNode").idempotentHint = false;

    expect(() => buildTools(spec)).toThrowError(/submitNode/);
    expect(() => buildTools(spec)).toThrowError(/idempotentHint/);
  });

  it("refuses an operation that states only two of the three hints", () => {
    const spec = doctorableSpec();
    delete annotationBlockIn(spec, "getSubtree").openWorldHint;

    expect(() => buildTools(spec)).toThrowError(/getSubtree: x-mcp is missing openWorldHint/);
  });

  it("builds all seventeen tools, so none of the rules above can pass over an empty list", () => {
    const tools = buildTools();
    expect(tools).toHaveLength(17);
    // Pinned whole, so a rule that stopped inspecting annotations cannot hide
    // behind a key-set comparison of two empty objects.
    expect(tools.find((tool) => tool.name === "submit_node")!.annotations).toEqual({
      title: "Submit a node",
      readOnlyHint: false,
      destructiveHint: true,
      // The generation it runs can reach arbitrary public pages through the
      // web-search gateway tool.
      openWorldHint: true,
    });
  });
});
