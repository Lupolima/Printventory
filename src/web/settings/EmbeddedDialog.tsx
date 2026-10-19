import { useLayoutEffect, useState } from 'react';
import { adopt } from '../shell/adopt';

type WithShowModal = HTMLDialogElement & { showModal: () => void };

/**
 * A settings dialog shown inside the Settings page (spec §47): while mounted, the <dialog> is
 * moved into this box and opened in place (non-modal) through its usual opener, so it loads its
 * saved values as always. When its own Save, Cancel or Close closes it, it opens again with the
 * saved values. On unmount it closes and goes back, and opens as a modal again elsewhere.
 * Its Close and Cancel buttons are hidden while it is in the page: there they only reopened it.
 */

/** Mark the footer's Close and Cancel buttons (hidden by settings.css while embedded); answers a function that unmarks them. */
function hideDismissButtons(dialog: HTMLDialogElement): () => void {
  const mark = () => {
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('.dialog-buttons > button')) {
      const label = (button.textContent || '').trim();
      if (label === 'Close' || label === 'Cancel') button.setAttribute('data-embedded-hide', '');
      else button.removeAttribute('data-embedded-hide');
    }
  };
  mark();
  // Footers change as the form loads (React re-renders them).
  const observer = new MutationObserver(mark);
  observer.observe(dialog, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    dialog.querySelectorAll('[data-embedded-hide]').forEach((button) => button.removeAttribute('data-embedded-hide'));
  };
}
export function EmbeddedDialog({ dialogId, opener }: { dialogId: string; opener: string }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const dialog = host ? (document.getElementById(dialogId) as WithShowModal | null) : null;
    if (!host || !dialog) return undefined;
    const restore = adopt(`#${CSS.escape(dialogId)}`, host);
    let alive = true;
    // Openers that load values first call showModal() later; one still loading when the page is
    // left must not pop up as a modal over the next page.
    let opening = false;
    const open = () => {
      const fn = (window as unknown as Record<string, unknown>)[opener];
      if (typeof fn !== 'function') return;
      opening = true;
      fn();
    };
    // The opener calls showModal(); here the dialog opens in the page instead.
    dialog.showModal = () => {
      opening = false;
      if (!dialog.open) dialog.show();
    };
    dialog.classList.add('is-embedded');
    const unhide = hideDismissButtons(dialog);
    const onClose = () => {
      if (alive)
        setTimeout(() => {
          if (alive) open();
        }, 0);
    };
    if (dialog.open) dialog.close();
    dialog.addEventListener('close', onClose);
    open();
    return () => {
      alive = false;
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      if (opening) {
        // Swallow the late showModal() of the opener still loading; the next real one works again.
        const late = () => {
          delete (dialog as Partial<WithShowModal>).showModal;
        };
        dialog.showModal = late;
        setTimeout(() => {
          if (dialog.showModal === late) delete (dialog as Partial<WithShowModal>).showModal;
        }, 10000);
      } else {
        delete (dialog as Partial<WithShowModal>).showModal;
      }
      unhide();
      dialog.classList.remove('is-embedded');
      restore?.();
    };
  }, [host, dialogId, opener]);

  return <div className="jp-settings-embed" ref={setHost} />;
}
