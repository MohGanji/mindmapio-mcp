// Types mirror the Mindmap.io unified node API (ADR 0021) OpenAPI 3.1 contract.
// Field names match the wire shapes exactly.

export interface MindMapSummary {
  id?: string;
  title?: string;
  kind?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Node {
  id: string;
  text?: string;
  parentId?: string | null;
  children: string[];
  nodeType?: string;
  status?: string;
  note?: string;
  imageUrl?: string;
  isRead?: boolean;
  isCollapsed?: boolean;
}

export interface MapData {
  rootId?: string | null;
  selectedId?: string | null;
  nodes?: Record<string, Node>;
}

export interface MindMap {
  id?: string;
  title?: string;
  kind?: string;
  user_id?: string;
  data?: MapData;
}

export interface SubtreeNode {
  node: Node;
  children: SubtreeNode[];
}

export interface SuccessResponse {
  success: boolean;
}

export interface CreateMapRequest {
  title?: string;
  kind?: string;
  data?: MapData;
}

export interface CreateMapResponse {
  id: string;
  title?: string;
  kind?: string;
}

export interface CreateNodeData {
  text?: string;
  note?: string;
  node_type?: string;
}

export interface CreateNodeRequest {
  nodeId: string;
  parentId: string;
  position?: number | null;
  data?: CreateNodeData;
}

export interface UpdateNodeRequest {
  text?: string;
  note?: string;
  node_type?: string;
  is_collapsed?: boolean;
  model_provider?: string;
  model_id?: string;
}

export interface SubmitNodeRequest {
  prompt?: string;
  modelId?: string;
}

export interface SubmitNodeResponse {
  nodeId: string;
  status: string;
  messages: Record<string, unknown>[];
}

export interface AutoExpandRequest {
  count?: number;
  direction?: string;
}

export interface AutoExpandResponse {
  nodeId: string;
  childIds: string[];
}

export interface RespondResponse {
  status: string;
  messages: Record<string, unknown>[];
}
