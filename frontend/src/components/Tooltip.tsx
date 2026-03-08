import { ReactNode, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTooltips } from '../contexts/TooltipContext';

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

interface AnchorRect {
  top: number; left: number; width: number; height: number;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

function TooltipPopup({ text, anchor }: { text: string; anchor: AnchorRect }) {
  const ref = useRef<HTMLDivElement>(null);
  // Start off-screen hidden so we can measure before revealing
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed', visibility: 'hidden', top: -9999, left: -9999, zIndex: 9999,
  });

  useEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    const { top, left, width, height, placement } = anchor;
    const gap = 8;
    let t = 0, l = 0;
    if (placement === 'top')    { t = top - h - gap;             l = left + width / 2 - w / 2; }
    if (placement === 'bottom') { t = top + height + gap;        l = left + width / 2 - w / 2; }
    if (placement === 'left')   { t = top + height / 2 - h / 2;  l = left - w - gap; }
    if (placement === 'right')  { t = top + height / 2 - h / 2;  l = left + width + gap; }
    // Clamp to viewport edges
    l = Math.max(4, Math.min(l, window.innerWidth - w - 4));
    t = Math.max(4, Math.min(t, window.innerHeight - h - 4));
    setStyle({ position: 'fixed', top: t, left: l, zIndex: 9999, visibility: 'visible' });
  }, [anchor]);

  return (
    <div ref={ref} style={style} className="pointer-events-none">
      <div className="bg-gray-700 dark:bg-gray-500 text-white text-xs rounded px-2 py-1 whitespace-nowrap shadow-lg max-w-xs leading-relaxed">
        {text}
      </div>
    </div>
  );
}

export function Tooltip({ text, children, position = 'top', className = '' }: TooltipProps) {
  const { tooltipsEnabled } = useTooltips();
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLDivElement>(null);

  if (!tooltipsEnabled || !text) return <>{children}</>;

  const show = () => {
    timerRef.current = setTimeout(() => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width, height: r.height, placement: position });
    }, 400);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setAnchor(null);
  };

  return (
    <div ref={wrapRef} className={`relative inline-flex ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {anchor && createPortal(<TooltipPopup text={text} anchor={anchor} />, document.body)}
    </div>
  );
}
