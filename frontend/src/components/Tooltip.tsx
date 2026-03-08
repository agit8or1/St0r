import { ReactNode, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTooltips } from '../contexts/TooltipContext';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({ text, children, position = 'top', className = '' }: TooltipProps) {
  const { tooltipsEnabled } = useTooltips();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const hoveringRef = useRef(false);

  const show = useCallback((e: React.MouseEvent) => {
    hoveringRef.current = true;
    const x = e.clientX;
    const y = e.clientY;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (hoveringRef.current) {
        setCoords({ x, y });
        setVisible(true);
      }
    }, 300);
  }, []);

  const hide = useCallback(() => {
    hoveringRef.current = false;
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const move = useCallback((e: React.MouseEvent) => {
    setCoords({ x: e.clientX, y: e.clientY });
  }, []);

  if (!tooltipsEnabled || !text) return <>{children}</>;

  const offsetY = position === 'bottom' ? 16 : -40;

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseMove={move}
    >
      {children}
      {visible && createPortal(
        <div
          style={{
            position: 'fixed',
            top: coords.y + offsetY,
            left: coords.x,
            transform: 'translateX(-50%)',
            zIndex: 99999,
            pointerEvents: 'none',
          }}
        >
          <div className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 shadow-lg leading-snug max-w-[260px] text-center whitespace-normal">
            {text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
