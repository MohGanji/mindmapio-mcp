import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSpec } from "../src/openapi.js";

/**
 * ADR 0029 declared a three-way parity invariant — the OpenAPI document, the
 * MCP tool list, and the published `SKILL.md` describe the same operations.
 * Two of those legs are already enforced: `buildTools` joins tools to the
 * document totally in both directions, and mindmap.io's own
 * `openapiCoverage.test.js` holds the document to the routes it describes.
 *
 * The skill leg was enforced by memory, and memory lost: attachments shipped
 * into the document and the tool list while the skill went on teaching 15 of
 * 17 operations, which is the worst of the three to be wrong — an agent
 * reading the skill has no second surface to notice the gap against (#546).
 *
 * So this joins the document to the skill. `auditSkill` is deliberately a pure
 * function of (spec, markdown) so the rules can be shown to bite against a
 * doctored document, rather than only ever being observed passing.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_PATH = join(repoRoot, "skills", "mindmapio", "SKILL.md");
const skill = readFileSync(SKILL_PATH, "utf8");
const spec = loadSpec();

const HTTP_METHODS = ["get", "put", "post", "delete", "patch"];

interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
  /** Everything the caller passes outside the path: query and header inputs. */
  inputs: { in: string; name: string }[];
  /** Failure statuses that mean something particular to this operation. */
  failures: string[];
}

/**
 * Statuses every authenticated operation can return for the same reasons. The
 * skill teaches these once, in its Errors section, so requiring them per
 * operation would be noise. Anything else — a 409, a 413, a 429 — changes what
 * the caller should do next and belongs where the operation is taught.
 */
const UNIVERSAL_FAILURES = ["400", "401", "403", "404"];

/** Resolve the local `$ref`s the document uses for shared parameters. */
function resolve(node: any, document: any): any {
  if (!node || typeof node !== "object" || typeof node.$ref !== "string") return node;
  return node.$ref
    .replace(/^#\//, "")
    .split("/")
    .reduce((current: any, key: string) => current?.[key], document);
}

/** Flatten the document into the operations an agent is expected to be able to call. */
function specOperations(document: any): SpecOperation[] {
  const operations: SpecOperation[] = [];
  for (const [path, item] of Object.entries<any>(document.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(item ?? {})) {
      if (!HTTP_METHODS.includes(method)) continue;
      const parameters = (operation.parameters ?? []).map((parameter: any) =>
        resolve(parameter, document),
      );
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        inputs: parameters
          .filter((parameter: any) => parameter?.in !== "path")
          .map((parameter: any) => ({ in: parameter.in, name: parameter.name })),
        failures: Object.keys(operation.responses ?? {}).filter(
          (status) => Number(status) >= 400 && !UNIVERSAL_FAILURES.includes(status),
        ),
      });
    }
  }
  return operations;
}

/**
 * One operation as the skill teaches it: the signature line that names it, the
 * prose written under that line, and the shell calls in its examples.
 */
interface TaughtOperation {
  method: string;
  path: string;
  /** Every line of the section, prose and example alike. */
  text: string[];
  calls: ApiCall[];
}

interface ApiCall {
  method: string;
  path: string;
}

const SIGNATURE = /`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`\s]*)`/;
const HEADING = /^#{1,6}\s/;
const FENCE = /^\s*```/;
/** A request path in an example, however it is quoted or interpolated. */
const CALLED_PATH = /\/api\/[^\s"'`)\\]+/g;
const CURL_METHOD = /-X\s+(GET|POST|PUT|PATCH|DELETE)\b/;

/**
 * Split the skill into the sections that teach an operation. A section opens on
 * an inline-code signature (`POST /api/…`) and closes at the next signature or
 * the next heading, so prose and examples are attributed to the operation they
 * sit under rather than to the document as a whole.
 *
 * Fenced blocks are tracked because they are both things at once: a `#` comment
 * inside one is not a heading, and the shell lines inside one are the only
 * place a worked example can live — a path written in prose is a mention, not a
 * call.
 */
function taughtOperations(markdown: string): TaughtOperation[] {
  const sections: TaughtOperation[] = [];
  let current: TaughtOperation | null = null;
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      current?.text.push(line);
      current?.calls.push(...requestsIn(line));
      continue;
    }

    const signature = SIGNATURE.exec(line);
    if (signature) {
      current = { method: signature[1], path: stripQuery(signature[2]), text: [line], calls: [] };
      sections.push(current);
      continue;
    }
    if (HEADING.test(line)) {
      current = null;
      continue;
    }
    current?.text.push(line);
  }

  return sections;
}

/** Every API call one line of an example makes; curl defaults to GET. */
function requestsIn(line: string): ApiCall[] {
  const method = CURL_METHOD.exec(line)?.[1] ?? "GET";
  return [...line.matchAll(CALLED_PATH)].map((match) => ({ method, path: stripQuery(match[0]) }));
}

function stripQuery(path: string): string {
  return path.split(/[?#]/)[0].replace(/\/$/, "");
}

/** Does a concrete or templated path match this operation's path template? */
function matchesTemplate(template: string, candidate: string): boolean {
  const wanted = template.split("/");
  const given = stripQuery(candidate).split("/");
  if (wanted.length !== given.length) return false;
  return wanted.every((segment, index) =>
    segment.startsWith("{") ? given[index].length > 0 : segment === given[index],
  );
}

/** The audit's verdict: one human-readable problem per broken rule. */
function auditSkill(document: any, markdown: string): string[] {
  const taught = taughtOperations(markdown);
  const operations = specOperations(document);
  const problems: string[] = [];

  for (const section of taught) {
    const documented = operations.some(
      (operation) =>
        operation.method === section.method && matchesTemplate(operation.path, section.path),
    );
    if (!documented) {
      problems.push(
        `the skill teaches ${section.method} ${section.path}, which the document does not describe`,
      );
    }
  }

  for (const operation of operations) {
    const section = taught.find(
      (candidate) =>
        candidate.method === operation.method && matchesTemplate(operation.path, candidate.path),
    );
    if (!section) {
      problems.push(
        `${operation.operationId}: the skill never teaches ${operation.method} ${operation.path}`,
      );
      continue;
    }

    const called = section.calls.some(
      (call) => call.method === operation.method && matchesTemplate(operation.path, call.path),
    );
    if (!called) {
      problems.push(
        `${operation.operationId}: the skill names ${operation.method} ${operation.path} but never calls it in an example`,
      );
    }

    const text = section.text.join("\n");
    for (const input of operation.inputs) {
      if (!text.includes(input.name)) {
        problems.push(
          `${operation.operationId}: the skill teaches it without the ${input.in} parameter \`${input.name}\``,
        );
      }
    }

    for (const failure of operation.failures) {
      if (!text.includes(failure)) {
        problems.push(
          `${operation.operationId}: the skill teaches it without the ${failure} it can answer with`,
        );
      }
    }
  }

  return problems;
}

describe("published skill against the OpenAPI document", () => {
  it("teaches every operation the document describes", () => {
    expect(
      auditSkill(spec, skill),
      "skills/mindmapio/SKILL.md is mirrored and digested at mindmap.io/.well-known/agent-skills — " +
        "fix it here, then re-run marketing/scripts/sync-agent-skills.mjs in the mindmap repo",
    ).toEqual([]);
  });

  it("reports an operation the skill has stopped teaching", () => {
    // The #546 drift, reproduced: the document grows an operation and the skill
    // does not. Removing the section is the mutation; the audit must notice.
    const withoutInterrupt = skill.replace(
      "`POST /api/mindmaps/{mapId}/nodes/{nodeId}/interrupt`",
      "the interrupt endpoint",
    );
    expect(auditSkill(spec, withoutInterrupt)).toContain(
      "interruptNode: the skill never teaches POST /api/mindmaps/{mapId}/nodes/{nodeId}/interrupt",
    );
  });

  it("reports an operation the skill names but never shows being called", () => {
    // The cheap way to satisfy a coverage check is to list the endpoint and
    // teach nothing. A worked call in the operation's own section is the
    // smallest thing that is actually guidance, so the audit insists on one.
    const nameOnly = editSection(skill, "**Submit a node**", (section) =>
      section.replace(/```bash[\s\S]*?```/, ""),
    );
    expect(auditSkill(spec, nameOnly)).toContain(
      "submitNode: the skill names POST /api/mindmaps/{mapId}/nodes/{nodeId}/submit but never calls it in an example",
    );
  });

  it("reports a section teaching something the document does not describe", () => {
    // The join runs both ways, as the tool join does. A skill that teaches an
    // endpoint the contract has dropped — or one deliberately kept out of it,
    // like map instructions (ADR 0029) — sends agents somewhere it should not.
    const overreaching = `${skill}\n**Set the instructions** — \`PATCH /api/mindmaps/{id}\`.\n\n\`\`\`bash\nmm /api/mindmaps/MAP_ID -X PATCH -d '{"instructions":"Be brief."}'\n\`\`\`\n`;
    expect(auditSkill(spec, overreaching)).toContain(
      "the skill teaches PATCH /api/mindmaps/{id}, which the document does not describe",
    );
  });

  it("reports a failure only this operation can return that its section never names", () => {
    // The other half of #541: submit could always answer 409 and the skill said
    // so only for retry. The universal statuses (400/401/403/404) live in the
    // Errors section; the ones that mean something particular to an operation
    // have to be taught where that operation is.
    const silent = editSection(skill, "**Retry a node**", (section) =>
      section.replaceAll("409", "an error"),
    );
    expect(auditSkill(spec, silent)).toContain(
      "retryNode: the skill teaches it without the 409 it can answer with",
    );
  });

  it("reports an input the document declares and the operation's section omits", () => {
    // #541's shape: the endpoint is taught, the flag that changes what it does
    // is not. Dropping `force` from retry's section is exactly that bug.
    const forceless = editSection(skill, "**Retry a node**", (section) =>
      section.replaceAll("force", ""),
    );
    expect(auditSkill(spec, forceless)).toContain(
      "retryNode: the skill teaches it without the query parameter `force`",
    );
  });
});

/**
 * Rewrite one operation's section of the skill, leaving the rest alone — how
 * each mutation above doctors the document. A section runs from its bold label
 * to the next one at the start of a line.
 */
function editSection(markdown: string, label: string, edit: (section: string) => string): string {
  const start = markdown.indexOf(label);
  expect(start, `${label} is not in the skill`).toBeGreaterThan(-1);
  const next = markdown.indexOf("\n**", start + label.length);
  const end = next === -1 ? markdown.length : next;
  return markdown.slice(0, start) + edit(markdown.slice(start, end)) + markdown.slice(end);
}
