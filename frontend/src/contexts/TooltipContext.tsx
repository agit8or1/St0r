import { createContext, useContext, useState, ReactNode } from 'react';

interface TooltipContextType {
  tooltipsEnabled: boolean;
  toggleTooltips: () => void;
}

const TooltipContext = createContext<TooltipContextType | undefined>(undefined);

export function TooltipsProvider({ children }: { children: ReactNode }) {
  const [tooltipsEnabled, setTooltipsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('tooltips');
    return saved === null ? true : saved === 'true';
  });

  const toggleTooltips = () => {
    setTooltipsEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('tooltips', String(next));
      return next;
    });
  };

  return (
    <TooltipContext.Provider value={{ tooltipsEnabled, toggleTooltips }}>
      {children}
    </TooltipContext.Provider>
  );
}

export function useTooltips() {
  const context = useContext(TooltipContext);
  if (context === undefined) {
    throw new Error('useTooltips must be used within a TooltipsProvider');
  }
  return context;
}
