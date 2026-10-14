import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * The welcome on the very first run. startup/start.ts asks for it as the page starts, possibly
 * before React has drawn anything, so the state lives here at module level and the dialog shows
 * it once mounted.
 */

declare global {
  interface Window {
    /** Show the welcome dialog (first run). */
    showWelcome?: () => void;
  }
}

let state = { welcome: false };
const listeners = new Set<() => void>();
function set(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

if (typeof window !== 'undefined') {
  window.showWelcome = () => set({ welcome: true });
}

/** After the welcome: choose the model folders (FolderSetup.tsx) instead of the guide. */
let foldersAfterWelcome = false;
export function setFoldersAfterWelcome(value: boolean) {
  foldersAfterWelcome = value;
}

/** Open or close a <dialog> with the state. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

export function FirstRun() {
  const { welcome } = useSyncExternalStore(subscribe, () => state);
  const welcomeRef = useModal(welcome);

  return (
    <dialog id="welcome-message" className="welcome-dialog" ref={welcomeRef} onClose={() => set({ welcome: false })}>
      <div className="welcome-content">
        <h2>Welcome to JusttPrint!</h2>
        <button
          id="dismiss-welcome"
          onClick={() => {
            set({ welcome: false });
            setTimeout(() => (foldersAfterWelcome ? window.openFolderSetup?.() : window.showGuide?.()), 500);
          }}
        >
          Get Started!
        </button>
      </div>
    </dialog>
  );
}
