import { useEffect } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { dismissScanResult, showNewModels, useScanProgress, useScanResult } from './scan';

/** How long "Scan finished" stays. */
const SHOW_MS = 10_000;

/** What a finished scan says (exported for tests). */
export function scanSummary(found: number, failed: number): string {
  const models = found === 0 ? 'no new models' : `${found.toLocaleString()} new ${found === 1 ? 'model' : 'models'}`;
  return `Scan finished: ${models}${failed ? ` (${failed} ${failed === 1 ? 'folder' : 'folders'} could not be scanned)` : ''}`;
}

/**
 * The notice for a scan started on this page (Scan Library, Scan a Folder, saving STL Home): that
 * it runs and how far it is, then how many models are new, with Show Them.
 */
export function ScanToast() {
  const progress = useScanProgress();
  const result = useScanResult();

  useEffect(() => {
    if (!result) return undefined;
    const timer = window.setTimeout(dismissScanResult, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  const body = progress ? (
    <div className="jp-undo-toast jp-scan-toast" data-testid="scan-toast" data-state="running">
      <Loader2 className="jp-spin" size={16} aria-hidden="true" />
      <span className="jp-undo-toast__text">Scanning the library… {progress.text}</span>
    </div>
  ) : result ? (
    <div className="jp-undo-toast jp-scan-toast" data-testid="scan-toast" data-state="done">
      <CheckCircle2 className="jp-scan-toast__done" size={16} aria-hidden="true" />
      <span className="jp-undo-toast__text">{scanSummary(result.found, result.failed)}</span>
      {result.found > 0 && (
        <button
          type="button"
          className="jp-undo-toast__button"
          onClick={() => {
            showNewModels(result.since);
            dismissScanResult();
          }}
        >
          Show Them
        </button>
      )}
      <button type="button" className="jp-undo-toast__close" aria-label="Dismiss" onClick={dismissScanResult}>
        ×
      </button>
    </div>
  ) : null;

  return (
    <div className="jp-undo-toast-region jp-scan-toast-region" role="status" aria-live="polite">
      {body}
    </div>
  );
}
