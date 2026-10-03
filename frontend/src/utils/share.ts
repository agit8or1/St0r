/**
 * Clipboard and sharing helpers for the "Help Us Grow" modal.
 *
 * St0r is frequently served over plain HTTP on a LAN, where
 * `navigator.clipboard` is unavailable (it is a secure-context API). Every copy
 * therefore falls back to a hidden textarea + `document.execCommand('copy')`,
 * and reports failure honestly so the UI can offer manual selection instead.
 */

/** Copy text, returning true only when the copy actually succeeded. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or blocked — fall through to the legacy path.
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it off-screen but focusable; `display: none` breaks execCommand.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** True when the browser offers the native share sheet for plain text/URLs. */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export type ShareResult = 'shared' | 'dismissed' | 'unsupported';

/**
 * Open the native share sheet. The user reviews and sends the message
 * themselves — nothing is transmitted by this app.
 */
export async function nativeShare(data: { title: string; text: string; url: string }): Promise<ShareResult> {
  if (!canNativeShare()) return 'unsupported';
  try {
    await navigator.share(data);
    return 'shared';
  } catch {
    // AbortError when the user closes the sheet; anything else is a refusal.
    return 'dismissed';
  }
}

/** Open a share target in a new tab. Never navigates the dashboard away. */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Pre-filled compose URLs. Each one lets the user edit before posting. */
export const shareTargets = {
  linkedin: (url: string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  facebook: (url: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  x: (url: string, text: string) =>
    `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  email: (subject: string, body: string) =>
    `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
};
