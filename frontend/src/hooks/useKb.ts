import { useEffect, useRef, useState } from 'react';
import { fetchCompanies, setActiveCompany } from './useGraph';

interface KbActiveResponse {
  active: string;
  path: string;
  hasTodo: boolean;
}

async function fetchActive(): Promise<KbActiveResponse> {
  const res = await fetch('/api/kb/active');
  return res.json() as Promise<KbActiveResponse>;
}

export function useKb(onInit: (hasTodo: boolean) => void) {
  const initialized = useRef(false);

  const [companies, setCompanies] = useState<string[]>([]);
  const [activeCompany, setActiveCompanyState] = useState('');
  const [activeKbPath, setActiveKbPath] = useState('');
  const [hasTodo, setHasTodo] = useState(false);

  useEffect(() => {
    // Guard against React StrictMode double-fire and future re-mounts.
    if (initialized.current) return;
    initialized.current = true;

    void (async () => {
      const [list, active] = await Promise.all([fetchCompanies(), fetchActive()]);
      setCompanies(list);
      setActiveCompanyState(active.active);
      setActiveKbPath(active.path);
      setHasTodo(active.hasTodo);
      onInit(active.hasTodo);
    })();
  }, []); // onInit intentionally omitted — only runs once on mount

  const handleCompanySwitch = async (company: string) => {
    await setActiveCompany(company);
    setActiveCompanyState(company);
    const active = await fetchActive();
    setActiveKbPath(active.path);
    setHasTodo(active.hasTodo);
    window.location.reload();
  };

  return { companies, activeCompany, activeKbPath, hasTodo, handleCompanySwitch };
}
