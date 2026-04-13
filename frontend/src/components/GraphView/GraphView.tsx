import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphEdge, GraphData } from '../../types';
import { fetchFileContent } from '../../hooks/useGraph';
import styles from './GraphView.module.css';

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
}

export default function GraphView({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nodeTypes = Array.from(new Set(data.nodes.map(n => n.type))).sort();

  const filteredNodes = data.nodes.filter(n => {
    const matchesType = typeFilter === 'all' || n.type === typeFilter;
    const matchesSearch = search === '' || n.label.toLowerCase().includes(search.toLowerCase()) || n.id.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

  const filteredEdges = data.edges.filter(e => {
    const src = typeof e.source === 'string' ? e.source : e.source.id;
    const tgt = typeof e.target === 'string' ? e.target : e.target.id;
    return filteredNodeIds.has(src) && filteredNodeIds.has(tgt);
  });

  const showTooltip = useCallback(async (nodeId: string, x: number, y: number, detailFile: string | null) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setTooltip({ x, y, content: '', loading: true, nodeId });
    if (!detailFile) {
      setTooltip({ x, y, content: 'No detail file.', loading: false, nodeId });
      return;
    }
    try {
      const content = await fetchFileContent(detailFile);
      // Show first 800 chars
      setTooltip({ x, y, content: content.slice(0, 800) + (content.length > 800 ? '\n…' : ''), loading: false, nodeId });
    } catch {
      setTooltip({ x, y, content: 'Could not load detail file.', loading: false, nodeId });
    }
  }, []);

  const hideTooltip = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setTooltip(null), 150);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 600;

    // Clear previous render
    d3.select(svg).selectAll('*').remove();

    const root = d3.select(svg)
      .attr('width', width)
      .attr('height', height);

    // Zoom container
    const g = root.append('g');

    root.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr('transform', String(event.transform));
        })
    );

    // Defs — arrowhead marker
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

    // Deep-copy nodes/edges so d3 can mutate them
    const nodes: GraphNode[] = filteredNodes.map(n => ({ ...n }));
    const nodesById = new Map(nodes.map(n => [n.id, n]));

    const edges: GraphEdge[] = filteredEdges.map(e => ({
      ...e,
      source: nodesById.get(typeof e.source === 'string' ? e.source : e.source.id) ?? e.source,
      target: nodesById.get(typeof e.target === 'string' ? e.target : e.target.id) ?? e.target,
    }));

    // Simulation
    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(edges).id(n => n.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(28));

    simRef.current = sim;

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)');

    // Edge labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', 9)
      .attr('text-anchor', 'middle')
      .text(e => e.type);

    // Nodes
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

    // Node labels
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

      linkLabel
        .attr('x', e => (((e.source as GraphNode).x ?? 0) + ((e.target as GraphNode).x ?? 0)) / 2)
        .attr('y', e => (((e.source as GraphNode).y ?? 0) + ((e.target as GraphNode).y ?? 0)) / 2);

      node.attr('cx', n => n.x ?? 0).attr('cy', n => n.y ?? 0);
      label.attr('x', n => n.x ?? 0).attr('y', n => n.y ?? 0);
    });

    // Highlight searched nodes
    if (search) {
      node.attr('stroke', n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ? '#fff' : 'var(--bg)'
      ).attr('stroke-width', n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ? 3 : 2
      );
    }

    return () => {
      sim.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes.length, filteredEdges.length, search, typeFilter]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Search nodes... (Ctrl+F)"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && setSearch('')}
          className={styles.searchInput}
        />
        <div className={styles.filters}>
          <button
            className={typeFilter === 'all' ? 'active' : ''}
            onClick={() => setTypeFilter('all')}
          >
            all
          </button>
          {nodeTypes.map(t => (
            <button
              key={t}
              className={typeFilter === t ? 'active' : ''}
              onClick={() => setTypeFilter(t)}
              style={{ borderLeftColor: nodeColor(t) }}
            >
              {t}
            </button>
          ))}
        </div>
        <span className={styles.count}>{filteredNodes.length} nodes · {filteredEdges.length} edges</span>
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
            <pre className={styles.tooltipContent}>{tooltip.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}
