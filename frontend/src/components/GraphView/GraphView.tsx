import { useEffect, useRef, useState, useCallback, memo } from 'react';
import * as d3 from 'd3';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Components } from 'react-markdown';
import { GraphNode, GraphEdge, GraphData } from '../../types';
import { fetchFileContent } from '../../hooks/useGraph';
import MermaidBlock from '../MermaidBlock/MermaidBlock';
import styles from './GraphView.module.css';

const markdownComponents: Components = {
  code({ className, children }) {
    if (className === 'language-mermaid') {
      return <MermaidBlock chart={String(children).trimEnd()} />;
    }
    return <code className={className}>{children}</code>;
  },
};

// Types considered "infrastructure" — what pipeline-only mode keeps visible
const PIPELINE_ONLY_TYPES = new Set([
  'service', 'service-detail',
  'pipeline',
  'db', 'database',
  'topic', 'kafka-topic',
]);

const NODE_COLORS: Record<string, string> = {
  service: 'var(--node-service)',
  'service-detail': 'var(--node-service)',
  pipeline: 'var(--node-pipeline)',
  component: 'var(--node-component)',
  db: 'var(--node-db)',
  database: 'var(--node-db)',
  topic: 'var(--node-topic)',
  'kafka-topic': 'var(--node-topic)',
  tech: 'var(--node-tech)',
  language: 'var(--node-tech)',
  'build-tool': 'var(--node-tech)',
  unknown: 'var(--node-unknown)',
};

function nodeColor(type: string): string {
  return NODE_COLORS[type.toLowerCase()] ?? 'var(--node-unknown)';
}

/** Smoothly fit the viewport around the given nodes. */
function fitView(
  svg: SVGSVGElement,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  nodes: GraphNode[],
  duration = 500,
) {
  const visible = nodes.filter(n => n.x != null && n.y != null);
  if (visible.length === 0) return;

  const pad = 60;
  const xs = visible.map(n => n.x!);
  const ys = visible.map(n => n.y!);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const x1 = Math.max(...xs) + pad;
  const y1 = Math.max(...ys) + pad;

  const rect = svg.getBoundingClientRect();
  const w = rect.width || 900;
  const h = rect.height || 600;
  const scale = Math.min(w / (x1 - x0), h / (y1 - y0), 1.5);
  const tx = w / 2 - scale * (x0 + x1) / 2;
  const ty = h / 2 - scale * (y0 + y1) / 2;

  d3.select(svg)
    .transition()
    .duration(duration)
    .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

interface TooltipContent {
  content: string;
  loading: boolean;
  nodeId: string;
  detailFile: string | null;
}

interface TooltipPos {
  x: number;
  y: number;
}

// Memoized so it only re-renders when content changes, not on every mousemove.
const TooltipBody = memo(function TooltipBody({ content }: { content: string }) {
  return (
    <div className={styles.tooltipContent}>
      <ReactMarkdown
        remarkPlugins={[remarkFrontmatter, remarkGfm]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

interface Props {
  data: GraphData;
  onNodeClick?: (filePath: string) => void;
}

type NodeSel = d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>;
type LinkSel = d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown>;
type TextSel<D> = d3.Selection<SVGTextElement, D, SVGGElement, unknown>;

export default function GraphView({ data, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // D3 selections kept across renders so the visibility effect can update
  // them without rebuilding the simulation.
  const nodeSelRef = useRef<NodeSel | null>(null);
  const linkSelRef = useRef<LinkSel | null>(null);
  const nodeLabelRef = useRef<TextSel<GraphNode> | null>(null);
  const linkLabelRef = useRef<TextSel<GraphEdge> | null>(null);

  // Stable ref so the simulation effect doesn't re-run when onNodeClick changes.
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);

  // Ctrl = highlight mode: hover shows neighbors, suppresses tooltip
  const ctrlModeRef = useRef(false);
  const highlightRef = useRef<Set<string> | null>(null);

  const [search, setSearch] = useState('');
  const [toolbarOpen, setToolbarOpen] = useState(true);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [onlyType, setOnlyType] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [pipelineOnly, setPipelineOnly] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState<string | null>(null);
  const filterHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tooltipContent, setTooltipContent] = useState<TooltipContent | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ x: 0, y: 0 });
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeTypes = Array.from(new Set(data.nodes.map(n => n.type))).sort();
  const pipelineNodes = data.nodes.filter(n => n.type.toLowerCase() === 'pipeline');

  // ── Pipeline connected set ────────────────────────────────────────────────
  const pipelineConnected = pipelineFilter
    ? (() => {
        const connected = new Set<string>([pipelineFilter]);
        for (const e of data.edges) {
          const src = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
          const tgt = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
          if (src === pipelineFilter) connected.add(tgt);
          if (tgt === pipelineFilter) connected.add(src);
        }
        return connected;
      })()
    : null;

  // ── Filtered sets (used for toolbar counts and visibility effect) ─────────
  const filteredNodes = data.nodes.filter(n => {
    if (pipelineOnly && !PIPELINE_ONLY_TYPES.has(n.type.toLowerCase())) return false;
    if (onlyType && n.type !== onlyType) return false;
    if (hiddenTypes.has(n.type)) return false;
    if (pipelineConnected && !pipelineConnected.has(n.id)) return false;
    if (search !== '' && !n.label.toLowerCase().includes(search.toLowerCase()) && !n.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredEdges = data.edges.filter(e => {
    const src = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
    const tgt = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
    return filteredNodeIds.has(src) && filteredNodeIds.has(tgt);
  });

  // String key representing visible node identity — changes only when the
  // visible set actually changes, used to trigger the visibility effect.
  const nodeKey = filteredNodes.map(n => n.id).join('\0');

  // ── Filter helpers ────────────────────────────────────────────────────────
  const resetFilters = () => {
    setHiddenTypes(new Set());
    setOnlyType(null);
    setPipelineFilter(null);
    setPipelineOnly(false);
  };

  const setOnly = (t: string) => {
    setOnlyType(prev => (prev === t ? null : t));
    setHiddenTypes(new Set());
  };

  const toggleHide = (t: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
    if (onlyType === t) setOnlyType(null);
  };

  const openHover = (t: string) => {
    if (filterHoverTimer.current) clearTimeout(filterHoverTimer.current);
    setHoveredFilter(t);
  };
  const closeHover = () => {
    filterHoverTimer.current = setTimeout(() => setHoveredFilter(null), 180);
  };
  const keepHover = () => {
    if (filterHoverTimer.current) clearTimeout(filterHoverTimer.current);
  };

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const showTooltip = useCallback(async (nodeId: string, x: number, y: number, detailFile: string | null) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setTooltipPos({ x, y });
    setTooltipContent({ content: '', loading: true, nodeId, detailFile });
    if (!detailFile) {
      setTooltipContent({ content: 'No detail file.', loading: false, nodeId, detailFile: null });
      return;
    }
    try {
      const content = await fetchFileContent(detailFile);
      setTooltipContent({ content: content.slice(0, 800) + (content.length > 800 ? '\n…' : ''), loading: false, nodeId, detailFile });
    } catch {
      setTooltipContent({ content: 'Could not load detail file.', loading: false, nodeId, detailFile: null });
    }
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setTooltipContent(null), 150);
  }, []);

  // ── Effect 1: build simulation ────────────────────────────────────────────
  // Runs only when server data changes (KB switch or file-watcher reload).
  // Filter changes do NOT restart the simulation — Effect 2 handles that.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 600;

    d3.select(svg).selectAll('*').remove();

    const root = d3.select(svg)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`);
    const g = root.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', String(event.transform));
      });
    root.call(zoom);
    zoomRef.current = zoom;

    const defs = root.append('defs');
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'var(--border)');

    // Build from ALL nodes/edges — filtering is handled by Effect 2.
    const nodes: GraphNode[] = data.nodes.map(n => ({ ...n }));
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    const edges: GraphEdge[] = data.edges.map(e => ({
      ...e,
      source: nodesById.get(typeof e.source === 'string' ? e.source : (e.source as GraphNode).id) ?? e.source,
      target: nodesById.get(typeof e.target === 'string' ? e.target : (e.target as GraphNode).id) ?? e.target,
    }));

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(edges).id(n => n.id).distance(160))
      .force('charge', d3.forceManyBody().strength(-600).distanceMax(600))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(50));

    simRef.current = sim;

    const link = g.append('g')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)');
    linkSelRef.current = link;

    const linkLabel = g.append('g')
      .selectAll<SVGTextElement, GraphEdge>('text')
      .data(edges)
      .join('text')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', 8)
      .attr('text-anchor', 'middle')
      .text(e => e.type);
    linkLabelRef.current = linkLabel;

    // Build adjacency map for shift+hover highlight
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      const src = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
      const tgt = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
      if (!neighbors.has(src)) neighbors.set(src, new Set());
      if (!neighbors.has(tgt)) neighbors.set(tgt, new Set());
      neighbors.get(src)!.add(tgt);
      neighbors.get(tgt)!.add(src);
    }

    const applyHighlight = (connected: Set<string> | null) => {
      highlightRef.current = connected;
      node.attr('opacity', n => !connected || connected.has(n.id) ? 1 : 0.1);
      label.attr('opacity', n => !connected || connected.has(n.id) ? 1 : 0.1);
      link.attr('opacity', e => {
        if (!connected) return 1;
        const src = (e.source as GraphNode).id;
        const tgt = (e.target as GraphNode).id;
        return connected.has(src) && connected.has(tgt) ? 1 : 0.05;
      });
      linkLabel.attr('opacity', e => {
        if (!connected) return 1;
        const src = (e.source as GraphNode).id;
        const tgt = (e.target as GraphNode).id;
        return connected.has(src) && connected.has(tgt) ? 1 : 0.05;
      });
    };

    const node = g.append('g')
      .selectAll<SVGCircleElement, GraphNode>('circle')
      .data(nodes)
      .join('circle')
      .attr('r', 14)
      .attr('fill', n => nodeColor(n.type))
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 2)
      .style('cursor', 'grab')
      .on('mouseover', (event: MouseEvent, n: GraphNode) => {
        if (ctrlModeRef.current) {
          const connected = new Set<string>([n.id, ...(neighbors.get(n.id) ?? [])]);
          applyHighlight(connected);
        } else {
          void showTooltip(n.id, event.clientX, event.clientY, n.detailFile);
        }
      })
      .on('mousemove', (event: MouseEvent) => {
        if (!ctrlModeRef.current) setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on('mouseout', () => {
        if (ctrlModeRef.current) {
          applyHighlight(null);
        } else {
          hideTooltip();
        }
      })
      .on('click', (_event: MouseEvent, n: GraphNode) => {
        if (onNodeClickRef.current && n.detailFile) onNodeClickRef.current(n.detailFile);
      })
      .call(
        d3.drag<SVGCircleElement, GraphNode>()
          .on('start', (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
          })
          .on('drag', (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) => {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          })
          .on('end', (event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) => {
            if (!event.active) sim.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
          })
      );
    nodeSelRef.current = node;

    const label = g.append('g')
      .selectAll<SVGTextElement, GraphNode>('text')
      .data(nodes)
      .join('text')
      .attr('fill', 'var(--text)')
      .attr('font-size', 11)
      .attr('text-anchor', 'middle')
      .attr('dy', 26)
      .text(n => n.label)
      .style('pointer-events', 'none');
    nodeLabelRef.current = label;

    sim.on('tick', () => {
      link
        .attr('x1', e => (e.source as GraphNode).x ?? 0)
        .attr('y1', e => (e.source as GraphNode).y ?? 0)
        .attr('x2', e => (e.target as GraphNode).x ?? 0)
        .attr('y2', e => (e.target as GraphNode).y ?? 0);

      linkLabel
        .attr('x', e => {
          const sx = (e.source as GraphNode).x ?? 0;
          const tx = (e.target as GraphNode).x ?? 0;
          return sx + (tx - sx) * 0.2;
        })
        .attr('y', e => {
          const sy = (e.source as GraphNode).y ?? 0;
          const ty = (e.target as GraphNode).y ?? 0;
          return sy + (ty - sy) * 0.2 - 4;
        });

      node.attr('cx', n => n.x ?? 0).attr('cy', n => n.y ?? 0);
      label.attr('x', n => n.x ?? 0).attr('y', n => n.y ?? 0);
    });

    // Auto-fit once the simulation has cooled enough for stable positions
    sim.on('end', () => {
      if (svgRef.current && zoomRef.current) {
        fitView(svgRef.current, zoomRef.current, nodes);
      }
    });

    // Ctrl held = highlight mode; release = clear highlight and resume tooltips
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlModeRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        ctrlModeRef.current = false;
        applyHighlight(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      sim.stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      nodeSelRef.current = null;
      linkSelRef.current = null;
      nodeLabelRef.current = null;
      linkLabelRef.current = null;
      zoomRef.current = null;
    };
  }, [data, showTooltip, hideTooltip]); // filter state intentionally excluded

  // ── Effect 2: update visibility ───────────────────────────────────────────
  // Runs when filter/search state changes. Just toggles display on existing
  // D3 elements — no simulation teardown, no nodes flying around.
  useEffect(() => {
    const nodeSel = nodeSelRef.current;
    const linkSel = linkSelRef.current;
    if (!nodeSel || !linkSel) return;

    const term = search.toLowerCase();

    nodeSel
      .attr('display', (n: GraphNode) => filteredNodeIds.has(n.id) ? null : 'none')
      .attr('stroke', (n: GraphNode) =>
        filteredNodeIds.has(n.id) && search && n.label.toLowerCase().includes(term) ? '#fff' : 'var(--bg)'
      )
      .attr('stroke-width', (n: GraphNode) =>
        filteredNodeIds.has(n.id) && search && n.label.toLowerCase().includes(term) ? 3 : 2
      );

    nodeLabelRef.current?.attr('display', (n: GraphNode) => filteredNodeIds.has(n.id) ? null : 'none');

    const edgeVisible = (e: GraphEdge): boolean => {
      const src = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id;
      const tgt = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id;
      return filteredNodeIds.has(src) && filteredNodeIds.has(tgt);
    };

    linkSel.attr('display', (e: GraphEdge) => edgeVisible(e) ? null : 'none');
    linkLabelRef.current?.attr('display', (e: GraphEdge) => edgeVisible(e) ? null : 'none');

    // Reheat so nodes re-arrange around the new visible set
    simRef.current?.alpha(0.3).restart();
  }, [nodeKey, search]); // eslint-disable-line react-hooks/exhaustive-deps
  // nodeKey changes whenever filteredNodeIds changes, so filteredNodeIds in
  // the closure above is always current when this effect fires.

  const isFiltered = onlyType !== null || hiddenTypes.size > 0 || pipelineFilter !== null || pipelineOnly;

  return (
    <div className={styles.container}>
      <div className={`${styles.toolbar} ${toolbarOpen ? '' : styles.toolbarCollapsed}`}>
        <button
          className={styles.toolbarToggle}
          onClick={() => setToolbarOpen(v => !v)}
          title={toolbarOpen ? 'Collapse toolbar' : 'Expand toolbar'}
        >
          {toolbarOpen ? '▲' : '▼'}
        </button>

        {toolbarOpen && (
          <>
            <input
              type="text"
              placeholder="Search nodes… (Ctrl+F)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setSearch('')}
              className={styles.searchInput}
            />

            <div className={styles.filters}>
              <button
                className={isFiltered ? styles.resetActive : ''}
                onClick={resetFilters}
                title="Show all"
              >
                all
              </button>

              <button
                className={pipelineOnly ? styles.filterOnly : ''}
                onClick={() => setPipelineOnly(v => !v)}
                title="Show only infrastructure nodes (services, databases, topics)"
              >
                pipeline only
              </button>

              {nodeTypes.map(t => {
                const isOnly = onlyType === t;
                const isHidden = hiddenTypes.has(t);
                return (
                  <div
                    key={t}
                    className={styles.filterItem}
                    onMouseEnter={() => openHover(t)}
                    onMouseLeave={closeHover}
                  >
                    <button
                      onClick={() => toggleHide(t)}
                      className={[
                        styles.filterBtn,
                        isOnly ? styles.filterOnly : '',
                        isHidden ? styles.filterHidden : '',
                      ].filter(Boolean).join(' ')}
                      style={{ borderLeftColor: nodeColor(t) }}
                      title={isOnly ? 'showing only' : isHidden ? 'hidden — click to show' : 'click to hide'}
                    >
                      {t}
                    </button>

                    {hoveredFilter === t && !isHidden && (
                      <div
                        className={styles.filterPopover}
                        onMouseEnter={keepHover}
                        onMouseLeave={closeHover}
                      >
                        <button onClick={() => { setOnly(t); setHoveredFilter(null); }}>
                          only
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {pipelineNodes.length > 0 && (
                <select
                  className={styles.pipelineSelect}
                  value={pipelineFilter ?? ''}
                  onChange={e => setPipelineFilter(e.target.value || null)}
                  title="Filter by pipeline"
                >
                  <option value="">all pipelines</option>
                  {pipelineNodes.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              )}
            </div>

            <span className={styles.count}>{filteredNodes.length} nodes · {filteredEdges.length} edges</span>
          </>
        )}
      </div>

      <svg ref={svgRef} className={styles.svg} />

      {tooltipContent && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 8,
            cursor: tooltipContent.detailFile ? 'pointer' : 'default',
          }}
          onMouseEnter={() => {
            if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
          }}
          onMouseLeave={hideTooltip}
          onClick={() => {
            if (tooltipContent.detailFile && onNodeClickRef.current) {
              onNodeClickRef.current(tooltipContent.detailFile);
            }
          }}
        >
          {tooltipContent.loading ? (
            <span className={styles.tooltipLoading}>loading…</span>
          ) : (
            <TooltipBody content={tooltipContent.content} />
          )}
        </div>
      )}
    </div>
  );
}
