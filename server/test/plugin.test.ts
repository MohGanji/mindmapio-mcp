import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => JSON.parse(readFileSync(join(repoRoot, ...parts), "utf8"));

const manifest = read(".claude-plugin", "plugin.json");
const marketplace = read(".claude-plugin", "marketplace.json");
const connector = read(".mcp.json");
const pkg = read("package.json");

/**
 * The plugin's three manifests describe the same thing from three angles, and
 * nothing at runtime notices when one drifts: a token key renamed in
 * plugin.json but not in .mcp.json substitutes to nothing, and the server
 * starts with no credential and fails on the first call.
 */
describe("plugin manifests", () => {
  it("passes the connector's token in from a declared, masked user config field", () => {
    const server = connector.mcpServers.mindmapio;
    const reference = server.env.MINDMAP_API_TOKEN;
    const key = /^\$\{user_config\.([A-Za-z0-9_]+)\}$/.exec(reference)?.[1];

    expect(key, `${reference} is not a user_config reference`).toBeDefined();
    const field = manifest.userConfig[key!];
    expect(field, `plugin.json declares no userConfig.${key}`).toBeDefined();
    expect(field.sensitive).toBe(true);
    expect(field.required).toBe(true);
  });

  it("runs this repo's own package, so the connector matches the documented install", () => {
    // Asserted against package.json rather than a literal, so transferring the
    // repo to another owner is a one-line change and not a hunt.
    const slug = /github\.com\/(.+?)(?:\.git)?$/.exec(pkg.repository.url)?.[1];
    const server = connector.mcpServers.mindmapio;
    expect(server.command).toBe("npx");
    expect(server.args).toContain(`github:${slug}`);
  });

  it("offers itself from its own marketplace, at the repo root", () => {
    const entry = marketplace.plugins.find((p: any) => p.name === manifest.name);
    expect(entry, `marketplace.json lists no plugin named ${manifest.name}`).toBeDefined();
    expect(entry.source).toBe("./");
  });

  it("keeps the plugin version and the package version in step", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("ships skills a plugin install can actually load", () => {
    const skills = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(skills).toContain("map-shaping");

    for (const skill of skills) {
      const body = readFileSync(join(repoRoot, "skills", skill, "SKILL.md"), "utf8");
      expect(body.startsWith("---\n"), `${skill}/SKILL.md has no frontmatter`).toBe(true);
      const frontmatter = body.slice(4, body.indexOf("\n---", 4));
      expect(frontmatter).toMatch(/^name:\s*\S+/m);
      expect(frontmatter).toMatch(/^description:/m);
    }
  });

  it("keeps the published skill where mindmap.io's discovery index fetches it", () => {
    // marketing/scripts/sync-agent-skills.mjs pulls this exact path from this
    // repo's default branch and publishes its SHA-256 in
    // /.well-known/agent-skills/index.json. Moving it is a two-repo change.
    const published = readFileSync(join(repoRoot, "skills", "mindmapio", "SKILL.md"), "utf8");
    expect(published).toContain("name: mindmapio");
  });
});
