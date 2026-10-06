import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'norzagapay_show_demo_data';

interface DemoDataContextValue {
  showDemoData: boolean;
  setShowDemoData: (enabled: boolean) => void;
  toggleDemoData: () => void;
}

const DemoDataContext = createContext<DemoDataContextValue | null>(null);

function readSavedPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [showDemoData, setShowDemoData] = useState(readSavedPreference);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(showDemoData));
    } catch {
      // The toggle still works for this session if browser storage is unavailable.
    }
  }, [showDemoData]);

  const toggleDemoData = () => setShowDemoData((current) => !current);

  return (
    <DemoDataContext.Provider value={{ showDemoData, setShowDemoData, toggleDemoData }}>
      {children}
    </DemoDataContext.Provider>
  );
}

export function useDemoData(): DemoDataContextValue {
  const context = useContext(DemoDataContext);
  if (!context) throw new Error('useDemoData must be used within a DemoDataProvider');
  return context;
}
