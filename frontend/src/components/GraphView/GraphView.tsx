import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { GraphNode, GraphEdge, GraphData } from '../../types';
import { fetchFileContent } from '../../hooks/useGraph';
import styles from './GraphView.module.css';

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

interface TooltipState {
  x: number;
  y: number;
  content: string;
  loading: boolean;
  nodeId: string;
}

interface Props {
  data: GraphData;
  onNodeClick?: (filePath: string) => void;
}

export default function GraphView({ data, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const [search, setSearch] = useState('');
  const [toolbarOpen, setToolbarOpen] = useState(true);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [onlyType, setOnlyType] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [pipelineOnly, setPipelineOnly] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState<string | null>(null);
  const filterHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
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

  // ── Node / edge filtering ─────────────────────────────────────────────────
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
    setTooltip({ x, y, content: '', loading: true, nodeId });
    if (!detailFile) {
      setTooltip({ x, y, content: 'No detail file.', loading: false, nodeId });
      return;
    }
    try {
      const content = await fetchFileContent(detailFile);
      setTooltip({ x, y, content: content.slice(0, 800) + (content.length > 800 ? '\n…' : ''), loading: false, nodeId });
    } catch {
      setTooltip({ x, y, content: 'Could not load detail file.', loading: false, nodeId });
    }
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setTooltip(null), 150);
  }, []);

  // ── D3 graph ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 600;

    d3.select(svg).selectAll('*').remove();

    const root = d3.select(svg).attr('width', width).attr('height', height);
    const g = root.append('g');

    root.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr('transform', String(event.transform));
        })
    );

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

    const nodes: GraphNode[] = filteredNodes.map(n => ({ ...n }));
    const nodesById = new Map(nodes.map(n => [n.id, n]));

    const edges: GraphEdge[] = filteredEdges.map(e => ({
      ...e,
      source: nodesById.get(typeof e.source === 'string' ? e.source : (e.source as GraphNode).id) ?? e.source,
      target: nodesById.get(typeof e.target === 'string' ? e.target : (e.target as GraphNode).id) ?? e.target,
    }));

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(edges).id(n => n.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(28));

    simRef.current = sim;

    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)');

    // Edge labels — positioned 20% from source, small font
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', 8)
      .attr('text-anchor', 'middle')
      .text(e => e.type);

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
        void showTooltip(n.id, event.clientX, event.clientY, n.detailFile);
      })
      .on('mousemove', (event: MouseEvent) => {
        setTooltip(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : null);
      })
      .on('mouseout', hideTooltip)
      .on('click', (_event: MouseEvent, n: GraphNode) => {
        if (onNodeClick && n.detailFile) onNodeClick(n.detailFile);
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

    const label = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('fill', 'var(--text)')
      .attr('font-size', 11)
      .attr('text-anchor', 'middle')
      .attr('dy', 26)
      .text(n => n.label)
      .style('pointer-events', 'none');

    sim.on('tick', () => {
      link
        .attr('x1', e => (e.source as GraphNode).x ?? 0)
        .attr('y1', e => (e.source as GraphNode).y ?? 0)
        .attr('x2', e => (e.target as GraphNode).x ?? 0)
        .attr('y2', e => (e.target as GraphNode).y ?? 0);

      // Place label 20% along the edge from source
      linkLabel
        .attr('x', e => {
          const sx = (e.source as GraphNode).x ?? 0;
          const tx = (e.target as GraphNode).x ?? 0;
          return sx + (tx - sx) * 0.2;
        })
        .attr('y', e => {
          const sy = (e.source as GraphNode).y ?? 0;
          const ty = (e.target as GraphNode).y ?? 0;
          return sy + (ty - sy) * 0.2 - 4; // slight offset above the line
        });

      node.attr('cx', n => n.x ?? 0).attr('cy', n => n.y ?? 0);
      label.attr('x', n => n.x ?? 0).attr('y', n => n.y ?? 0);
    });

    if (search) {
      node.attr('stroke', n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ? '#fff' : 'var(--bg)'
      ).attr('stroke-width', n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ? 3 : 2
      );
    }

    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes.length, filteredEdges.length, search, onlyType, hiddenTypes, pipelineFilter, pipelineOnly, onNodeClick]);

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

      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x + 16, top: tooltip.y - 8 }}
          onMouseEnter={() => {
            if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
          }}
          onMouseLeave={hideTooltip}
        >
          {tooltip.loading ? (
            <span className={styles.tooltipLoading}>loading…</span>
          ) : (
            <div className={styles.tooltipContent}>
              <ReactMarkdown remarkPlugins={[remarkFrontmatter, remarkGfm]}>
                {tooltip.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
