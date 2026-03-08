import { ReactNode, useState, useRef } from 'react';
import { useTooltips } from '../contexts/TooltipContext';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const boxPos: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const arrowStyle: Record<string, React.CSSProperties> = {
  top: {
    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
    borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
    borderTop: '4px solid #1f2937',
  },
  bottom: {
    position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
    borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
    borderBottom: '4px solid #1f2937',
  },
  left: {
    position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
    borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
    borderLeft: '4px solid #1f2937',
  },
  right: {
    position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)',
    borderTop: '4px solid transparent', borderBottom: '4px solid transparent',
    borderRight: '4px solid #1f2937',
  },
};

export function Tooltip({ text, children, position = 'top', className = '' }: TooltipProps) {
  const { tooltipsEnabled } = useTooltips();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  if (!tooltipsEnabled || !text) return <>{children}</>;

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => { timerRef.current = setTimeout(() => setVisible(true), 350); }}
      onMouseLeave={() => { clearTimeout(timerRef.current); setVisible(false); }}
    >
      {children}
      {visible && (
        <div className={`absolute z-50 ${boxPos[position]} pointer-events-none`}>
          <div className="bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg max-w-xs">
            {text}
          </div>
          <div style={arrowStyle[position]} />
        </div>
      )}
    </div>
  );
}
