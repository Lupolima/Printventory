import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { jobActions, useThumbnailJob, type Job } from '../thumbnails/jobs';
import { progressText as aiText, stopAiTagJob, useAiTagJob } from '../tags/aiJob';
import { amountText, etaText, percentOf as activityPercent, shown as shownActivity, useActivity, type Activity } from '../activity/activity';
import { useCan, useCurrentUser } from '../session';

const percentOf = (job: Job) => (job.total > 0 ? Math.min(100, Math.floor((job.processed / job.total) * 100)) : 0);

/** Re-render every second while there are jobs (a job shows once it has run for a moment). */
function useTick(active: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** One job's bar: what it is, how far, and how long it should still take. */
function ActivityRow({ job, children }: { job: Activity; children?: ReactNode }) {
  const percent = activityPercent(job);
  const ids =
    job.kind === 'ai-tagging'
      ? { box: 'ai-tag-progress-container', text: 'ai-tag-progress-text' }
      : job.kind === 'thumbnails'
        ? { box: 'render-progress-container', text: 'render-progress-text' }
        : { box: undefined, text: undefined };
  // AI Tagging keeps its own words ("AI tagging: 3/12"), which other parts of the app look for.
  const title = job.kind === 'ai-tagging' ? `AI tagging: ${job.done}/${job.total ?? '?'}` : job.label;
  const line = [job.kind === 'ai-tagging' ? '' : amountText(job), etaText(job.etaMs)].filter(Boolean).join(' · ');
  return (
    <div className="jp-bgjob" id={ids.box} data-kind={job.kind}>
      <div className="jp-bgjob__title" id={ids.text}>
        {title}
        {job.detail && <span className="jp-bgjob__detail"> · {job.detail}</span>}
      </div>
      <div
        className={`jp-bgjob__track${percent == null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={job.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <span style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      {line && <div className="jp-bgjob__line">{line}</div>}
      {children}
    </div>
  );
}

/**
 * The sidebar's progress, above Library Storage: everything running in the background on the
 * server (src/server/activity.js: library scans, AI Tagging, Categorize Library, thumbnails,
 * duplicate checks, site downloads, uploads, backups and moves), each with how far it is and how
 * long it should still take; nothing when nothing runs. A finished AI Tagging run stays for
 * whoever started it until its tags are reviewed.
 */
export function SidebarProgress() {
  const [slot] = useState(() => document.getElementById('sidebar-progress-slot'));
  const all = useActivity();
  useTick(all.length > 0);
  const jobs = shownActivity(all);
  const thumbs = useThumbnailJob();
  const ai = useAiTagJob();
  const me = useCurrentUser();
  const canEdit = useCan('editor');
  const mine = !!ai.job && (!ai.job.by || ai.job.by === me?.username);
  // A finished run waiting for its review (only for whoever started it).
  const toReview = ai.job && !ai.job.running && mine && !ai.reviewing ? ai.job : null;
  if (!slot || (!jobs.length && !toReview)) return null;
  return createPortal(
    <div className="progress-section jp-bgjobs" id="progress-section" aria-label="Running in the background">
      {jobs.map((job) => (
        <ActivityRow key={job.id} job={job}>
          {job.kind === 'ai-tagging' && ai.job?.running && (mine || canEdit) && (
            <div className="progress-actions">
              {mine && !ai.reviewing && (
                <button type="button" id="ai-tag-review" className="jp-job-button" onClick={() => window.openAiTagReview?.()}>
                  Review
                </button>
              )}
              {canEdit && (
                <button type="button" id="ai-tag-stop" className="stop-button" disabled={ai.job.stopping} onClick={() => stopAiTagJob()}>
                  Stop
                </button>
              )}
            </div>
          )}
          {job.kind === 'thumbnails' && canEdit && thumbs && !thumbs.done && (
            <button id="stop-thumbnail-generation" className="stop-button" disabled={thumbs.stopping} onClick={jobActions.stop}>
              {thumbs.stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
        </ActivityRow>
      ))}
      {toReview && (
        <div className="jp-bgjob" id="ai-tag-progress-container" data-kind="ai-tagging">
          <div className="jp-bgjob__title" id="ai-tag-progress-text">
            {aiText(toReview)}
          </div>
          <div className="progress-actions">
            <button type="button" id="ai-tag-review" className="jp-job-button" onClick={() => window.openAiTagReview?.()}>
              Review
            </button>
          </div>
        </div>
      )}
    </div>,
    slot
  );
}

/** The dialog for a thumbnail job started here (until sent to the background). */
export function ThumbnailJobDialog() {
  const job = useThumbnailJob();
  if (!job || job.background) return null;
  const percent = percentOf(job);
  const counted = job.total > 0;
  return (
    <div id="thumbnail-progress-overlay" className="tp-overlay" role="dialog" aria-modal="true" aria-labelledby="thumbnail-progress-title">
      <div className="tp-panel">
        <h3 className="tp-title" id="thumbnail-progress-title">
          {job.title}
        </h3>
        <p className="tp-phase" id="thumbnail-progress-phase">
          {job.phase}
        </p>
        <div className={`tp-track${counted || job.done ? '' : ' tp-indeterminate'}`} id="thumbnail-progress-track">
          <div className="tp-fill" id="thumbnail-progress-fill" style={counted ? { width: `${percent}%` } : undefined} />
        </div>
        <div className="tp-meta">
          <span id="thumbnail-progress-count">{counted ? `${Math.min(job.processed, job.total)} / ${job.total}` : ''}</span>
          <span id="thumbnail-progress-percent">{counted ? `${percent}%` : ''}</span>
        </div>
        {!job.done && (
          <div className="tp-actions">
            <button type="button" className="tp-background" id="thumbnail-progress-background" disabled={job.stopping} onClick={jobActions.background}>
              Background
            </button>
            <button type="button" className="tp-cancel" id="thumbnail-progress-cancel" disabled={job.stopping} onClick={jobActions.stop}>
              {job.stopping ? 'Stopping...' : 'Stop'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
