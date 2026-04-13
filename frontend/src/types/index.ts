export interface GraphNode {
  id: string;
  label: string;
  type: string;
  status?: string;
  detailFile: string | null;
  // d3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  reason: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type View = 'graph' | 'todo' | 'terminal';
