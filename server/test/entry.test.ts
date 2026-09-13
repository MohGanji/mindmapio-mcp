import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntryModule } from "../src/server.js";

/**
 * `npx` and every MCP client that runs `npx -y github:MohGanji/mindmapio-mcp`
 * invoke the package through the `node_modules/.bin` symlink, so the process
 * argv carries the *link* path while the module's own url carries the *real*
 * one. A naive comparison of the two says "not the entry module" and the
 * server silently never starts.
 */
describe("isEntryModule", () => {
  /** A scratch dir with symlinks already resolved, the way Node reports paths. */
  function scratch(): string {
    return realpathSync(mkdtempSync(join(tmpdir(), "mmio-entry-")));
  }

  it("recognises the module when it is run by its own path", () => {
    const dir = scratch();
    const real = join(dir, "server.js");
    writeFileSync(real, "");
    expect(isEntryModule(pathToFileURL(real).href, real)).toBe(true);
  });

  it("recognises the module when it is run through a bin symlink", () => {
    const dir = scratch();
    const real = join(dir, "server.js");
    const link = join(dir, "mindmapio-mcp");
    writeFileSync(real, "");
    symlinkSync(real, link);
    expect(isEntryModule(pathToFileURL(real).href, link)).toBe(true);
  });

  it("rejects a different module (imported, not run)", () => {
    const dir = scratch();
    const real = join(dir, "server.js");
    const other = join(dir, "vitest.js");
    writeFileSync(real, "");
    writeFileSync(other, "");
    expect(isEntryModule(pathToFileURL(real).href, other)).toBe(false);
  });

  it("rejects a missing entry path instead of throwing", () => {
    const dir = scratch();
    const real = join(dir, "server.js");
    writeFileSync(real, "");
    expect(isEntryModule(pathToFileURL(real).href, join(dir, "gone.js"))).toBe(false);
    expect(isEntryModule(pathToFileURL(real).href, undefined)).toBe(false);
  });
});
