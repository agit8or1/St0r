import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Heart,
  Share2,
  Link as LinkIcon,
  ClipboardCopy,
  Check,
  Star,
  Github,
  Linkedin,
  Facebook,
  Mail,
  ExternalLink,
  Briefcase,
  X,
} from 'lucide-react';
import {
  THIS_PROJECT,
  OTHER_PROJECTS,
  BUSINESS,
  GITHUB,
  NETWORK_SHARE_MESSAGE,
  projectShareMessage,
  projectShortShare,
  GrowthProject,
} from '../config/growth';
import { copyText, canNativeShare, nativeShare, openExternal, shareTargets } from '../utils/share';

interface HelpUsGrowModalProps {
  open: boolean;
  onClose: () => void;
}

/** Focusable elements inside the dialog, for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * The "Help Us Grow" support modal.
 *
 * Sharing is the primary action and sits above the fold; everything else
 * follows. Nothing is ever posted on the user's behalf — each action either
 * opens the native share sheet, opens a pre-filled compose window the user
 * reviews and sends, or copies text to the clipboard.
 */
export function HelpUsGrowModal({ open, onClose }: HelpUsGrowModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /** Which action last copied successfully, for the transient confirmation. */
  const [copied, setCopied] = useState<string | null>(null);
  /** Text to select manually when the clipboard is unavailable. */
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  const shareMessage = projectShareMessage();
  const shareSupported = canNativeShare();

  // Remember what had focus, move focus into the dialog, restore on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button: a safe, predictable first stop for screen readers.
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape to close + Tab cycling confined to the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter((n) => n.offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    // Don't let the page behind the dialog scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Reset transient state whenever the dialog is reopened.
  useEffect(() => {
    if (!open) {
      setCopied(null);
      setCopyFallback(null);
    }
  }, [open]);

  /** Copy, and only confirm when the copy actually worked. */
  const handleCopy = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopyFallback(null);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2200);
    } else {
      setCopied(null);
      setCopyFallback(text);
      window.setTimeout(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      }, 0);
    }
  }, []);

  const handleNativeShare = useCallback(
    async (title: string, text: string, url: string, copyKey: string) => {
      const result = await nativeShare({ title, text, url });
      if (result === 'unsupported') {
        // No share sheet (most desktop browsers): copy the message instead so
        // the user still walks away with something to paste.
        await handleCopy(copyKey, text);
      }
    },
    [handleCopy],
  );

  if (!open) return null;

  const copyLabel = (key: string, fallback: string, done: string) =>
    copied === key ? done : fallback;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black bg-opacity-60 p-3 sm:p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-us-grow-title"
        aria-describedby="help-us-grow-intro"
        onClick={(e) => e.stopPropagation()}
        className="my-auto flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:max-h-[calc(100vh-3rem)]"
      >
        {/* Header */}
        <div className="relative flex-shrink-0 bg-gradient-to-r from-rose-500 to-pink-600 px-5 py-5 sm:px-7 sm:py-6">
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-start gap-3 pr-10">
            <Heart className="mt-0.5 h-8 w-8 flex-shrink-0 fill-current text-white" />
            <div>
              <h2 id="help-us-grow-title" className="text-xl font-bold leading-snug text-white sm:text-2xl">
                Love what we&rsquo;re building? Help us grow.
              </h2>
              <p id="help-us-grow-intro" className="mt-1.5 text-sm leading-relaxed text-rose-50">
                A quick share, a GitHub star, or a recommendation can make a real difference. Help more
                people discover our projects and keep development moving.
              </p>
            </div>
          </div>
        </div>

        {/* Body — scrolls within the viewport */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
          {/* Clipboard fallback */}
          {copyFallback && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
              <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                Copying isn&rsquo;t available in this browser. Select the text below and copy it manually
                (Ctrl/&#8984; + C).
              </p>
              <textarea
                ref={fallbackRef}
                readOnly
                value={copyFallback}
                rows={3}
                aria-label="Text to copy manually"
                className="input text-sm"
              />
            </div>
          )}

          {/* 1. Share the project — primary action, above the fold */}
          <section
            aria-labelledby="grow-share-heading"
            className="rounded-xl border-2 border-rose-200 bg-rose-50/60 p-4 dark:border-rose-800 dark:bg-rose-900/15 sm:p-5"
          >
            <div className="mb-2 flex items-center gap-2">
              <Share2 className="h-5 w-5 flex-shrink-0 text-rose-600 dark:text-rose-400" />
              <h3
                id="grow-share-heading"
                className="text-base font-bold text-gray-900 dark:text-gray-100"
              >
                Share the project
              </h3>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Know someone who could use this? Share it with your team, another business owner, or your
              favorite IT community.
            </p>

            <button
              onClick={() => handleNativeShare(THIS_PROJECT.name, shareMessage, THIS_PROJECT.url, 'share-primary')}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              {copied === 'share-primary' ? <Check className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
              {copied === 'share-primary' ? 'Message copied!' : 'Share This Project'}
            </button>
            {!shareSupported && (
              <p className="mt-2 text-center text-xs text-gray-600 dark:text-gray-400">
                This browser has no share sheet &mdash; the button copies the message for you to paste.
              </p>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => handleCopy('link', THIS_PROJECT.url)}
                aria-label={`Copy link to ${THIS_PROJECT.name}`}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:border-rose-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-rose-900/30"
              >
                {copied === 'link' ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <LinkIcon className="h-4 w-4" />}
                {copyLabel('link', 'Copy Link', 'Link copied!')}
              </button>
              <button
                onClick={() => handleCopy('message', shareMessage)}
                className="flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:border-rose-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-rose-900/30"
              >
                {copied === 'message' ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <ClipboardCopy className="h-4 w-4" />}
                {copyLabel('message', 'Copy Ready-to-Post Message', 'Message copied!')}
              </button>
            </div>

            {/* Per-network compose windows. The user reviews and sends. */}
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Or share on
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ShareNetworkButton
                  icon={<Linkedin className="h-4 w-4" />}
                  label="LinkedIn"
                  onClick={() => openExternal(shareTargets.linkedin(THIS_PROJECT.url))}
                />
                <ShareNetworkButton
                  icon={<Facebook className="h-4 w-4" />}
                  label="Facebook"
                  onClick={() => openExternal(shareTargets.facebook(THIS_PROJECT.url))}
                />
                <ShareNetworkButton
                  icon={<XLogo />}
                  label="X"
                  onClick={() => openExternal(shareTargets.x(THIS_PROJECT.url, shareMessage))}
                />
                <ShareNetworkButton
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  onClick={() =>
                    openExternal(shareTargets.email(`Thought you'd like ${THIS_PROJECT.name}`, shareMessage))
                  }
                />
              </div>
            </div>

            <p className="mt-3 rounded-lg bg-white/70 p-3 text-xs italic leading-relaxed text-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
              &ldquo;{shareMessage}&rdquo;
            </p>
          </section>

          {/* 2. Other projects */}
          <section aria-labelledby="grow-projects-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 sm:p-5">
            <h3 id="grow-projects-heading" className="mb-1 text-base font-bold text-gray-900 dark:text-gray-100">
              Discover &amp; share our other projects
            </h3>
            <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Help spread the word about the other tools and services we&rsquo;re building.
            </p>

            <div className="space-y-3">
              {OTHER_PROJECTS.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  copied={copied}
                  onCopy={handleCopy}
                  onShare={handleNativeShare}
                />
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50">
              <p className="mb-2 text-xs italic leading-relaxed text-gray-600 dark:text-gray-400">
                &ldquo;{NETWORK_SHARE_MESSAGE}&rdquo;
              </p>
              <button
                onClick={() => handleCopy('network', NETWORK_SHARE_MESSAGE)}
                className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {copied === 'network' ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <ClipboardCopy className="h-4 w-4" />}
                {copyLabel('network', 'Copy Network Message', 'Message copied!')}
              </button>
            </div>
          </section>

          {/* 3. GitHub */}
          <section aria-labelledby="grow-github-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 sm:p-5">
            <div className="mb-1 flex items-center gap-2">
              <Star className="h-5 w-5 flex-shrink-0 fill-current text-yellow-500" />
              <h3 id="grow-github-heading" className="text-base font-bold text-gray-900 dark:text-gray-100">
                Star &amp; explore on GitHub
              </h3>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              A GitHub star helps others discover the project. Explore the code, follow development, and
              share your favorites.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {THIS_PROJECT.repoUrl && (
                <button
                  onClick={() => openExternal(THIS_PROJECT.repoUrl!)}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-yellow-300 bg-yellow-50 px-4 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-500 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-gray-100 dark:hover:bg-yellow-900/40"
                >
                  <Star className="h-4 w-4 fill-current text-yellow-500" />
                  Star This Project
                  <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                </button>
              )}
              <button
                onClick={() => openExternal(GITHUB.orgUrl)}
                className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                <Github className="h-4 w-4" />
                Explore Our GitHub
                <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
              </button>
            </div>
          </section>

          {/* 4. Sponsor — omitted entirely when no destination is configured */}
          {GITHUB.sponsorUrl && (
            <section aria-labelledby="grow-sponsor-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 sm:p-5">
              <div className="mb-1 flex items-center gap-2">
                <Heart className="h-5 w-5 flex-shrink-0 fill-current text-pink-600 dark:text-pink-400" />
                <h3 id="grow-sponsor-heading" className="text-base font-bold text-gray-900 dark:text-gray-100">
                  Sponsor development
                </h3>
              </div>
              <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                Want to help fund ongoing development, improvements, and maintenance? Consider becoming a
                sponsor.
              </p>
              <button
                onClick={() => openExternal(GITHUB.sponsorUrl!)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-pink-700 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                <Heart className="h-4 w-4 fill-current" />
                Sponsor Development
                <ExternalLink className="h-3.5 w-3.5 text-white/70" />
              </button>
            </section>
          )}

          {/* 5. Support our business */}
          <section aria-labelledby="grow-business-heading" className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 sm:p-5">
            <div className="mb-1 flex items-center gap-2">
              <Briefcase className="h-5 w-5 flex-shrink-0 text-primary-600 dark:text-primary-400" />
              <h3 id="grow-business-heading" className="text-base font-bold text-gray-900 dark:text-gray-100">
                Support our business
              </h3>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Need IT services or know a business that does? Visit {BUSINESS.name} or recommend us to
              someone who could use a hand.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => openExternal(BUSINESS.url)}
                className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                Visit {BUSINESS.name}
                <ExternalLink className="h-3.5 w-3.5 text-white/70" />
              </button>
              <button
                onClick={() =>
                  handleNativeShare(BUSINESS.name, projectShortShare(BUSINESS), BUSINESS.url, 'share-business')
                }
                className="flex items-center justify-center gap-2 rounded-xl border border-primary-300 bg-white px-4 py-2.5 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-gray-800 dark:text-primary-300 dark:hover:bg-primary-900/30"
              >
                {copied === 'share-business' ? <Check className="h-4 w-4 text-green-600 dark:text-green-400" /> : <Share2 className="h-4 w-4" />}
                {copied === 'share-business' ? 'Message copied!' : `Share ${BUSINESS.name}`}
              </button>
            </div>
            {BUSINESS.secondary && (
              <button
                onClick={() => openExternal(BUSINESS.secondary!.url)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm text-gray-600 underline-offset-2 transition-colors hover:text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:text-primary-300"
              >
                <Facebook className="h-4 w-4" />
                {BUSINESS.secondary.label}
              </button>
            )}
          </section>

          <p className="pt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Every share, recommendation, star, and contribution helps. Thanks for being part of what
            we&rsquo;re building.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShareNetworkButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Share on ${label}`}
      className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      {icon}
      {label}
    </button>
  );
}

/** lucide-react 0.303 still ships the bird mark, so draw the current X glyph. */
function XLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.4 22H2.3l7.4-8.5L1.5 2h6.7l4.8 6.4L18.9 2Zm-1.1 18h1.7L7.4 3.8H5.6l12.2 16.2Z" />
    </svg>
  );
}

function ProjectCard({
  project,
  copied,
  onCopy,
  onShare,
}: {
  project: GrowthProject;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  onShare: (title: string, text: string, url: string, copyKey: string) => void;
}) {
  const shareKey = `share-${project.id}`;
  const copyKey = `copy-${project.id}`;
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="font-semibold text-gray-900 dark:text-gray-100">{project.name}</p>
        <span className="break-all text-xs text-gray-500 dark:text-gray-400">{project.url}</span>
      </div>
      {project.description && (
        <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {project.description}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => openExternal(project.url)}
          aria-label={`Visit ${project.name}`}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          Visit
          <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button
          onClick={() => onShare(project.name, projectShortShare(project), project.url, shareKey)}
          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
        >
          {copied === shareKey ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied === shareKey ? 'Message copied!' : `Share ${project.name}`}
        </button>
        <button
          onClick={() => onCopy(copyKey, project.url)}
          aria-label={`Copy link to ${project.name}`}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {copied === copyKey ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <LinkIcon className="h-3.5 w-3.5" />}
          {copied === copyKey ? 'Link copied!' : 'Copy Link'}
        </button>
      </div>
    </div>
  );
}
