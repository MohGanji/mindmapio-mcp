import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const built = join(repoRoot, "server", "dist", "server.js");

/**
 * The published install path, end to end: `npx -y github:MohGanji/mindmapio-mcp`
 * and the plugin's `.mcp.json` both execute the package through a
 * `node_modules/.bin` symlink. This spawns the built entry point the same way
 * and speaks MCP to it, so a regression that stops the server from starting
 * shows up here instead of as a silent no-op in someone's client.
 */
describe("stdio launch", () => {
  beforeAll(() => {
    if (!existsSync(built)) {
      execFileSync("npx", ["tsc", "-p", "server"], { cwd: repoRoot, stdio: "inherit" });
    }
  }, 120_000);

  async function handshake(entry: string): Promise<string> {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, MINDMAP_API_TOKEN: "test-token" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const request = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "launch-test", version: "0.0.0" },
      },
    };
    child.stdin.write(`${JSON.stringify(request)}\n`);

    const line = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error(`no response; stdout was ${JSON.stringify(buffer)}`)), 15_000);
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        const newline = buffer.indexOf("\n");
        if (newline !== -1) {
          clearTimeout(timer);
          resolve(buffer.slice(0, newline));
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error(`exited before responding; stdout was ${JSON.stringify(buffer)}`));
      });
    }).finally(() => child.kill());

    return line;
  }

  it("answers an initialize request when run by its own path", async () => {
    const response = JSON.parse(await handshake(built));
    expect(response.result.serverInfo.name).toBe("mindmapio-mcp");
  }, 30_000);

  it("answers an initialize request when run through a bin symlink", async () => {
    const bin = join(mkdtempSync(join(tmpdir(), "mmio-bin-")), "mindmapio-mcp");
    symlinkSync(built, bin);
    const response = JSON.parse(await handshake(bin));
    expect(response.result.serverInfo.name).toBe("mindmapio-mcp");
  }, 30_000);
});
