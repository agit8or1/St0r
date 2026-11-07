import { createContext, useContext } from 'react';

interface TooltipContextType {
  tooltipsEnabled: boolean;
  toggleTooltips: () => void;
}

// Provided by TooltipsProvider in contexts/TooltipContext.tsx.
export const TooltipContext = createContext<TooltipContextType | undefined>(undefined);

export function useTooltips() {
  const context = useContext(TooltipContext);
  if (context === undefined) {
    throw new Error('useTooltips must be used within a TooltipsProvider');
  }
  return context;
}
