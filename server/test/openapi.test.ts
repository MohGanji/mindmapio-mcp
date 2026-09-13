import { describe, expect, it } from "vitest";
import { loadSpec, readOperations } from "../src/openapi.js";

/**
 * These run against the vendored copy of the published document
 * (`server/spec/openapi.json`), never the network, so the tool list is
 * reproducible offline and a spec change is a reviewable diff.
 */
describe("readOperations", () => {
  it("carries an operation's own description and its x-mcp annotations", () => {
    const op = readOperations(loadSpec()).get("submitNode");
    expect(op).toBeDefined();
    expect(op!.title).toBe("Submit a node");
    expect(op!.readOnlyHint).toBe(false);
    // Submitting a node that already has children can cascade them away.
    expect(op!.destructiveHint).toBe(true);
    // The document's description is the reason it is the source: it documents
    // the blocking gate and the metering that the hand-written copy omitted.
    expect(op!.description).toContain("The call BLOCKS");
    expect(op!.description).toContain("429");
  });

  it("refuses a document whose operations carry no x-mcp block", () => {
    const unannotated = {
      paths: {
        "/api/mindmaps": {
          get: { operationId: "listMindmaps", description: "Lists maps." },
          post: { operationId: "createMap", description: "Creates a map." },
        },
      },
    };
    expect(() => readOperations(unannotated)).toThrowError(/listMindmaps: no x-mcp block/);
    expect(() => readOperations(unannotated)).toThrowError(/createMap: no x-mcp block/);
  });

  it("refuses a partial x-mcp block rather than guessing the missing hint", () => {
    const partial = {
      paths: {
        "/api/mindmaps/{id}": {
          delete: {
            operationId: "deleteMap",
            description: "Deletes a map.",
            "x-mcp": { title: "Delete a map", readOnlyHint: false },
          },
        },
      },
    };
    expect(() => readOperations(partial)).toThrowError(/deleteMap: x-mcp is missing destructiveHint/);
  });

  it("names the refresh command so the failure says what to do next", () => {
    expect(() => readOperations({ paths: { "/x": { get: { operationId: "x", description: "d" } } } })).toThrowError(
      /npm run sync:openapi/,
    );
  });
});
