import {
  ZOOM_LEVELS,
  type Attachment,
  type AttachmentDownload,
  type AttachmentUpload,
  type AutoExpandRequest,
  type AutoExpandResponse,
  type CreateMapRequest,
  type CreateMapResponse,
  type CreateNodeRequest,
  type MindMap,
  type MindMapSummary,
  type Node,
  type PublicMapUrls,
  type PublishMapResponse,
  type RespondResponse,
  type SubmitNodeRequest,
  type SubmitNodeResponse,
  type SubtreeNode,
  type SuccessResponse,
  type UpdateNodeRequest,
  type ZoomLevel,
} from "./types.js";

const DEFAULT_BASE_URL = "https://mindmap.io";

export interface MindmapClientOptions {
  token?: string;
  baseUrl?: string;
}

/**
 * An error raised when the API returns a non-2xx response. Carries the HTTP
 * status and the parsed (JSON) or raw (text) body. The bearer token is never
 * stored on this error, so logging it cannot leak the secret.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Mindmap API error ${status}: ${ApiError.describe(body)}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  private static describe(body: unknown): string {
    if (typeof body === "string") return body;
    if (body && typeof body === "object" && "error" in body) {
      return String((body as { error: unknown }).error);
    }
    return JSON.stringify(body);
  }
}

/** A typed HTTP client over the Mindmap.io unified node API (ADR 0021). */
export class MindmapClient {
  // Kept in a closure-like private field; never exposed, logged, or serialized.
  readonly #token: string;
  readonly #baseUrl: string;

  constructor(options: MindmapClientOptions = {}) {
    const token = options.token ?? process.env.MINDMAP_API_TOKEN ?? "";
    if (!token) {
      throw new Error(
        "Missing Mindmap API token. Set MINDMAP_API_TOKEN or pass { token }.",
      );
    }
    const baseUrl = options.baseUrl || process.env.MINDMAP_API_BASE_URL || DEFAULT_BASE_URL;
    this.#token = token;
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // --- maps ---------------------------------------------------------------

  listMaps(): Promise<MindMapSummary[]> {
    return this.#request<MindMapSummary[]>("GET", "/api/mindmaps");
  }

  getMap(id: string): Promise<MindMap> {
    return this.#request<MindMap>("GET", `/api/mindmaps/${encodeURIComponent(id)}`);
  }

  createMap(body: CreateMapRequest): Promise<CreateMapResponse> {
    return this.#request<CreateMapResponse>("POST", "/api/mindmaps", body);
  }

  deleteMap(id: string): Promise<SuccessResponse> {
    return this.#request<SuccessResponse>("DELETE", `/api/mindmaps/${encodeURIComponent(id)}`);
  }

  // --- publishing (ADR 0021) ---------------------------------------------

  /** Publish a map: owner-only, mints/reuses a public slug and returns it. */
  publishMap(id: string): Promise<PublishMapResponse> {
    return this.#request<PublishMapResponse>("POST", `${this.#mapPath(id)}/publish`);
  }

  /** Unpublish a map: flips it back to private, 404ing every public link. */
  unpublishMap(id: string): Promise<SuccessResponse> {
    return this.#request<SuccessResponse>("DELETE", `${this.#mapPath(id)}/publish`);
  }

  /**
   * Build the shareable + embeddable links for a published map, framed on first
   * paint by `node=root`, the semantic `zoom` level, and the canvas `cz` percent.
   * Pure string building over the client's base url — no request. An unknown
   * zoom falls back to 'full', matching the app and the marketing URL builder.
   */
  publicMapUrls(
    publicId: string,
    { zoom = "full", cz = 100 }: { zoom?: ZoomLevel; cz?: number } = {},
  ): PublicMapUrls {
    const level = ZOOM_LEVELS.includes(zoom) ? zoom : "full";
    const query = new URLSearchParams({ node: "root", zoom: level, cz: String(cz) }).toString();
    const slug = encodeURIComponent(publicId);
    return {
      publicId,
      viewerUrl: `${this.#baseUrl}/app/${slug}?${query}`,
      embedUrl: `${this.#baseUrl}/app/embed/${slug}?${query}`,
    };
  }

  // --- attachments ---------------------------------------------------------

  /**
   * Upload one file into a map. The body is the file itself, not a multipart
   * envelope: one file per request needs none. The name travels percent-encoded
   * in `X-Filename` because a header cannot carry arbitrary bytes.
   */
  uploadAttachment(mapId: string, file: AttachmentUpload): Promise<Attachment> {
    const headers: Record<string, string> = { "content-type": file.mediaType };
    if (file.filename) headers["x-filename"] = encodeURIComponent(file.filename);
    return this.#request<Attachment>("POST", `${this.#mapPath(mapId)}/files`, file.bytes, headers);
  }

  /** Read an uploaded file back as bytes. Authorization is decided per file. */
  async readAttachment(attachmentId: string): Promise<AttachmentDownload> {
    const response = await this.#send("GET", `/api/files/${encodeURIComponent(attachmentId)}`);
    if (!response.ok) {
      throw new ApiError(response.status, await this.#parse(response));
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  // --- nodes (read) -------------------------------------------------------

  getNode(mapId: string, nodeId: string): Promise<SubtreeNode> {
    return this.#request<SubtreeNode>("GET", this.#nodePath(mapId, nodeId));
  }

  getSubtree(mapId: string, nodeId: string, depth?: number): Promise<SubtreeNode> {
    const query = depth === undefined ? "" : `?depth=${depth}`;
    return this.#request<SubtreeNode>("GET", `${this.#nodePath(mapId, nodeId)}/subtree${query}`);
  }

  // --- nodes (write) ------------------------------------------------------

  createNode(mapId: string, body: CreateNodeRequest): Promise<Node> {
    return this.#request<Node>("POST", `${this.#mapPath(mapId)}/nodes`, body);
  }

  updateNode(mapId: string, nodeId: string, body: UpdateNodeRequest): Promise<SuccessResponse> {
    return this.#request<SuccessResponse>("PATCH", this.#nodePath(mapId, nodeId), body);
  }

  deleteNode(mapId: string, nodeId: string): Promise<SuccessResponse> {
    return this.#request<SuccessResponse>("DELETE", this.#nodePath(mapId, nodeId));
  }

  // --- generation ---------------------------------------------------------

  submitNode(mapId: string, nodeId: string, body: SubmitNodeRequest = {}): Promise<SubmitNodeResponse> {
    return this.#request<SubmitNodeResponse>("POST", `${this.#nodePath(mapId, nodeId)}/submit`, body);
  }

  autoExpand(mapId: string, nodeId: string, body: AutoExpandRequest = {}): Promise<AutoExpandResponse> {
    return this.#request<AutoExpandResponse>(
      "POST",
      `${this.#nodePath(mapId, nodeId)}/auto-expand`,
      body,
    );
  }

  retryNode(
    mapId: string,
    nodeId: string,
    options: { force?: boolean; body?: SubmitNodeRequest } = {},
  ): Promise<RespondResponse> {
    const query = options.force ? "?force=true" : "";
    return this.#request<RespondResponse>(
      "POST",
      `${this.#nodePath(mapId, nodeId)}/retry${query}`,
      options.body ?? {},
    );
  }

  interruptNode(mapId: string, nodeId: string): Promise<Node> {
    return this.#request<Node>("POST", `${this.#nodePath(mapId, nodeId)}/interrupt`);
  }

  // --- internals ----------------------------------------------------------

  #mapPath(mapId: string): string {
    return `/api/mindmaps/${encodeURIComponent(mapId)}`;
  }

  #nodePath(mapId: string, nodeId: string): string {
    return `${this.#mapPath(mapId)}/nodes/${encodeURIComponent(nodeId)}`;
  }

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const response = await this.#send(method, path, body, extraHeaders);
    const payload = await this.#parse(response);

    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }
    return payload as T;
  }

  /**
   * One authenticated request. A body is JSON unless the caller supplies its own
   * content-type, which is how a file's raw bytes go up untouched.
   */
  #send(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#token}`,
      accept: "application/json",
      ...extraHeaders,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      if (headers["content-type"] === undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(body);
      } else {
        init.body = body as RequestInit["body"];
      }
    }
    return fetch(`${this.#baseUrl}${path}`, init);
  }

  async #parse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }
}
