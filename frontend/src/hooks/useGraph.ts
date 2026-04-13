import { useEffect, useState, useCallback } from 'react';
import { GraphData } from '../types';

const API = '/api/kb';

export function useGraph() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/graph`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as GraphData;
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  // SSE file-change listener — reload graph on changes
  useEffect(() => {
    const es = new EventSource('/api/watch');
    es.onmessage = () => void fetchGraph();
    return () => es.close();
  }, [fetchGraph]);

  return { data, loading, error, refetch: fetchGraph };
}

export async function fetchFileContent(filePath: string, kb?: 'todo'): Promise<string> {
  const params = new URLSearchParams({ p: filePath });
  if (kb) params.set('kb', kb);
  const res = await fetch(`${API}/file?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { content: string };
  return json.content;
}

export async function writeFileContent(filePath: string, content: string, kb?: 'todo'): Promise<void> {
  const params = new URLSearchParams({ p: filePath });
  if (kb) params.set('kb', kb);
  await fetch(`${API}/file?${params.toString()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function fetchTodoFiles(): Promise<string[]> {
  const res = await fetch(`${API}/todo/files`);
  if (!res.ok) return [];
  return await res.json() as string[];
}

export async function fetchCompanies(): Promise<string[]> {
  const res = await fetch(`${API}/companies`);
  if (!res.ok) return [];
  return await res.json() as string[];
}

export async function setActiveCompany(company: string): Promise<void> {
  await fetch('/api/kb/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company }),
  });
}
