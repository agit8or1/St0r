import { useState, ReactNode } from 'react';
import { TooltipContext } from '../hooks/useTooltips';

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
