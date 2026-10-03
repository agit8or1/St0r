import { useState } from 'react';
import { Heart } from 'lucide-react';
import { HelpUsGrowModal } from './HelpUsGrowModal';

interface HelpUsGrowButtonProps {
  /**
   * `nav` — full-width row that matches the sidebar nav items.
   * `pill` — standalone rounded button for use inside page content.
   */
  variant?: 'nav' | 'pill';
  /**
   * Hide the label below the `sm` breakpoint, leaving the heart alone. The
   * accessible name is kept via `aria-label` and the title attribute.
   */
  collapseLabel?: boolean;
  className?: string;
}

const LABEL = 'Help Us Grow';

/**
 * The "Help Us Grow" entry point: a heart with a gentle heartbeat and a soft
 * red glow that opens the support modal. The modal never opens on its own.
 *
 * The heartbeat is pure CSS (the `.heartbeat` class in
 * index.css) and is disabled under `prefers-reduced-motion: reduce`.
 */
export function HelpUsGrowButton({ variant = 'nav', collapseLabel = false, className = '' }: HelpUsGrowButtonProps) {
  const [open, setOpen] = useState(false);

  const base =
    'group inline-flex items-center gap-3 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800';

  const variants = {
    nav:
      'w-full rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20',
    pill:
      'rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-6 py-3 text-base font-semibold text-white shadow-lg hover:from-rose-600 hover:to-pink-700 hover:shadow-xl',
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={LABEL}
        aria-haspopup="dialog"
        title={LABEL}
        className={`${base} ${variants[variant]} ${className}`}
      >
        <Heart
          aria-hidden="true"
          className={`heartbeat h-5 w-5 flex-shrink-0 fill-current ${
            variant === 'nav' ? 'text-rose-500 dark:text-rose-400' : 'text-white'
          }`}
        />
        <span className={`whitespace-nowrap ${collapseLabel ? 'hidden sm:inline' : ''}`}>{LABEL}</span>
      </button>
      <HelpUsGrowModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
