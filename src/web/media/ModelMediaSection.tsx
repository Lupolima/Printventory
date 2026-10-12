import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Film, Image as ImageIcon, Link2, Play, Plus, Star, Trash2 } from 'lucide-react';
import { uploadFile, uploads, type MediaKind, type UploadInfo } from '../api';
import { Button, IconButton, cx } from '../components/Button';
import { Modal } from '../components/Overlay';
import { formatFileSize } from '../library/paths';
import { askText, onServerEvent, showMessage } from '../page';
import { useCan } from '../session';
import { joinFolder } from '../upload/plan';
import { DocumentViewer, MediaImage } from './MediaViews';
import { EMPTY_MEDIA, isPlayable, media as mediaApi, mediaUrl, youtubeEmbed, youtubeThumb, type MediaFile, type ModelMedia } from './media';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ADD_LABELS: Record<MediaKind, string> = { image: 'Add Pictures', video: 'Add Videos', document: 'Add Documents' };

/** What the viewer shows: a picture (with the others to step through) or a document. */
type Viewing = { kind: 'image'; index: number } | { kind: 'document'; file: MediaFile };

/** A YouTube video: its picture until played, then YouTube's player (no YouTube cookies before that). */
function YoutubeVideo({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const [playing, setPlaying] = useState(false);
  return (
    <li className="jp-media__video">
      {playing ? (
        <iframe
          src={`${youtubeEmbed(id)}?autoplay=1`}
          title="YouTube video"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="jp-media__youtube" onClick={() => setPlaying(true)} aria-label="Play the YouTube video">
          <img src={youtubeThumb(id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <Play size={36} aria-hidden="true" />
        </button>
      )}
      <div className="jp-media__caption">
        <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer noopener">
          YouTube <ExternalLink size={12} aria-hidden="true" />
        </a>
        {onRemove && <IconButton icon={Trash2} size="sm" label="Remove the YouTube video" onClick={onRemove} />}
      </div>
    </li>
  );
}

/**
 * A model folder's pictures, videos and documents (src/server/model-folders.js), on a model's
 * page and a folder's page: view and play them here; editors add and remove them and choose the
 * cover (the picture the library shows). `folder` is the model's folder; `alone` says whether the
 * model is the only one in it (then an editor may make it the model's folder).
 */
export function ModelMediaSection({ folder, alone, compact = false }: { folder: string; alone: boolean; compact?: boolean }) {
  const canEdit = useCan('editor');
  const [found, setFound] = useState<ModelMedia>(EMPTY_MEDIA);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const info = useRef<UploadInfo | null>(null);
  const inputs = { image: useRef<HTMLInputElement>(null), video: useRef<HTMLInputElement>(null), document: useRef<HTMLInputElement>(null) };

  const load = useCallback(() => {
    mediaApi.get(folder).then(
      (next) => {
        setFound(next);
        setLoaded(true);
      },
      () => {
        setFound(EMPTY_MEDIA);
        setLoaded(true);
      }
    );
  }, [folder]);

  useEffect(() => {
    load();
    const off = onServerEvent('folder-changed', (payload: { path?: string } | undefined) => {
      if (!payload?.path || payload.path === found.folder || payload.path === folder) load();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    if (canEdit)
      uploads.info().then(
        (result) => (info.current = result),
        () => {}
      );
  }, [canEdit]);

  async function run(label: string, action: () => Promise<ModelMedia | void>) {
    setBusy(label);
    try {
      const next = await action();
      if (next) setFound(next);
    } catch (error) {
      await showMessage('Pictures, Videos and Documents', errorText(error));
    } finally {
      setBusy('');
    }
  }

  async function add(kind: MediaKind, files: File[]) {
    const where = found.folder || folder;
    await run(`Adding ${files.length === 1 ? files[0].name : `${files.length} files`}…`, async () => {
      const paths: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading ${files[i].name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}…`);
        try {
          const result = await uploadFile(files[i], joinFolder(where, kind), { chunkBytes: info.current?.chunkBytes || 16 * 1024 * 1024 });
          paths.push(result.filePath);
        } catch (error) {
          failed.push(`${files[i].name}: ${errorText(error)}`);
        }
      }
      if (paths.length) await uploads.finish(joinFolder(where, kind), paths);
      if (failed.length) await showMessage('Not added', failed.join('\n'));
      return mediaApi.get(where);
    });
  }

  async function remove(kind: MediaKind, file: MediaFile) {
    const answer = await showMessage('Remove', `Move ${file.name} to the Trash?`, ['Move to Trash', 'Cancel']);
    if (answer !== 'Move to Trash') return;
    if (viewing) setViewing(null);
    await run('Removing…', () => mediaApi.remove(found.folder || folder, kind, file.name));
  }

  async function addYoutube() {
    const link = await askText('Add a YouTube Video', 'The YouTube link (youtube.com/watch?v=… or youtu.be/…):');
    if (!link || !link.trim()) return;
    await run('Adding…', () => mediaApi.addYoutube(found.folder || folder, [link.trim()]));
  }

  if (!loaded) return null;

  if (!found.isModelFolder) {
    // The details panel shows a model folder's media only (its page offers to make one).
    if (!canEdit || compact) return null;
    return (
      <section className="jp-card jp-media" aria-labelledby="jp-media-title" id="jp-model-media">
        <h2 className="jp-panel-title" id="jp-media-title">
          Pictures, Videos and Documents
        </h2>
        {alone ? (
          <>
            <p className="jp-meta">
              Keep this model's pictures, videos and documents with it, in image, video and document folders next to its file. They become part of this model,
              not models of their own.
            </p>
            <Button size="sm" id="jp-media-register" disabled={!!busy} onClick={() => void run('…', () => mediaApi.register(folder))}>
              Keep Them in This Folder
            </Button>
          </>
        ) : (
          <p className="jp-meta">
            This folder holds other models too. Pictures, videos and documents belong to a model's own folder: Organize → Tidy Into Model Folders gives each
            model one.
          </p>
        )}
      </section>
    );
  }

  const where = found.folder || folder;
  const accept = (kind: MediaKind) => (info.current?.mediaExtensions?.[kind] || []).join(',');
  const empty = !found.image.length && !found.video.length && !found.youtube.length && !found.document.length;
  if (empty && !canEdit) return null;
  const imageCount = found.image.length;
  const shownImage = viewing?.kind === 'image' ? found.image[Math.min(viewing.index, imageCount - 1)] : null;

  const header = (kind: MediaKind, title: string, count: number, extra?: React.ReactNode) => (
    <div className="jp-media__head">
      <h3 className="jp-media__title">
        {title}
        {count > 0 && <span className="jp-meta"> {count}</span>}
      </h3>
      {canEdit && (
        <span className="jp-media__add">
          {extra}
          <Button size="sm" icon={Plus} disabled={!!busy} id={`jp-media-add-${kind}`} onClick={() => inputs[kind].current?.click()}>
            {ADD_LABELS[kind]}
          </Button>
          <input
            ref={inputs[kind]}
            type="file"
            multiple
            hidden
            accept={accept(kind)}
            data-kind={kind}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              if (files.length) void add(kind, files);
            }}
          />
        </span>
      )}
    </div>
  );

  return (
    <section
      className={compact ? 'jp-details__section jp-media is-compact' : 'jp-card jp-media'}
      aria-labelledby={compact ? 'jp-details-media-title' : 'jp-media-title'}
      id={compact ? 'jp-details-media' : 'jp-model-media'}
      data-folder={where}
    >
      {compact ? (
        <h3 className="jp-details__heading" id="jp-details-media-title">
          Pictures, Videos and Documents
        </h3>
      ) : (
        <h2 className="jp-panel-title" id="jp-media-title">
          Pictures, Videos and Documents
        </h2>
      )}
      {busy && (
        <p className="jp-meta jp-media__busy" role="status">
          {busy}
        </p>
      )}

      {(imageCount > 0 || canEdit) && (
        <div className="jp-media__group" id="jp-media-images">
          {header('image', 'Pictures', imageCount)}
          {imageCount === 0 ? (
            <p className="jp-meta">No pictures yet. The first one added becomes the cover.</p>
          ) : (
            <ul className="jp-media__images">
              {found.image.map((file, index) => {
                const isCover = found.cover === file.name;
                return (
                  <li key={file.name} className={cx('jp-media__image', isCover && 'is-cover')} data-name={file.name}>
                    <button type="button" className="jp-media__open" title={file.name} onClick={() => setViewing({ kind: 'image', index })}>
                      <MediaImage file={file} alt={file.name} />
                    </button>
                    {isCover && <span className="jp-media__badge">Cover</span>}
                    {canEdit && (
                      <span className="jp-media__tools">
                        {!isCover && (
                          <IconButton
                            icon={Star}
                            size="sm"
                            label={`Make ${file.name} the cover`}
                            disabled={!!busy}
                            onClick={() => void run('Setting the cover…', () => mediaApi.setCover(where, file.name))}
                          />
                        )}
                        <IconButton icon={Trash2} size="sm" label={`Remove ${file.name}`} disabled={!!busy} onClick={() => void remove('image', file)} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {(found.video.length > 0 || found.youtube.length > 0 || canEdit) && (
        <div className="jp-media__group" id="jp-media-videos">
          {header(
            'video',
            'Videos',
            found.video.length + found.youtube.length,
            <Button size="sm" icon={Link2} disabled={!!busy} id="jp-media-add-youtube" onClick={() => void addYoutube()}>
              Add YouTube Link
            </Button>
          )}
          {found.video.length + found.youtube.length === 0 ? (
            <p className="jp-meta">No videos yet.</p>
          ) : (
            <ul className="jp-media__videos">
              {found.video.map((file) => (
                <li key={file.name} className="jp-media__video" data-name={file.name}>
                  {isPlayable(file.name) ? (
                    <video src={mediaUrl(file.path)} controls preload="metadata" playsInline />
                  ) : (
                    <div className="jp-media__unplayable">
                      <Film size={28} aria-hidden="true" />
                      <span>Browsers cannot play MPEG videos: download it to watch it.</span>
                    </div>
                  )}
                  <div className="jp-media__caption">
                    <span className="jp-media__name" title={file.name}>
                      {file.name}
                    </span>
                    <span className="jp-meta">{formatFileSize(file.size)}</span>
                    <a className="jp-icon-link" href={mediaUrl(file.path, true)} download={file.name} aria-label={`Download ${file.name}`} title="Download">
                      <Download size={14} aria-hidden="true" />
                    </a>
                    {canEdit && (
                      <IconButton icon={Trash2} size="sm" label={`Remove ${file.name}`} disabled={!!busy} onClick={() => void remove('video', file)} />
                    )}
                  </div>
                </li>
              ))}
              {found.youtube.map((video) => (
                <YoutubeVideo
                  key={video.id}
                  id={video.id}
                  onRemove={canEdit ? () => void run('Removing…', () => mediaApi.removeYoutube(where, video.id)) : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {(found.document.length > 0 || canEdit) && (
        <div className="jp-media__group" id="jp-media-documents">
          {header('document', 'Documents', found.document.length)}
          {found.document.length === 0 ? (
            <p className="jp-meta">No documents yet: instructions, manuals, assembly guides, parts lists.</p>
          ) : (
            <ul className="jp-media__documents">
              {found.document.map((file) => (
                <li key={file.name} className="jp-media__document" data-name={file.name}>
                  <FileText size={18} aria-hidden="true" />
                  <button
                    type="button"
                    className="jp-link-button jp-media__name"
                    title={`Open ${file.name}`}
                    onClick={() => setViewing({ kind: 'document', file })}
                  >
                    {file.name}
                  </button>
                  <span className="jp-meta">{formatFileSize(file.size)}</span>
                  <a className="jp-icon-link" href={mediaUrl(file.path, true)} download={file.name} aria-label={`Download ${file.name}`} title="Download">
                    <Download size={14} aria-hidden="true" />
                  </a>
                  {canEdit && (
                    <IconButton icon={Trash2} size="sm" label={`Remove ${file.name}`} disabled={!!busy} onClick={() => void remove('document', file)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={shownImage ? shownImage.name : viewing?.kind === 'document' ? viewing.file.name : ''}
        className={cx('jp-media-viewer', viewing?.kind === 'document' && 'is-document')}
        footer={
          viewing && (
            <>
              {shownImage && canEdit && found.cover !== shownImage.name && (
                <Button icon={Star} disabled={!!busy} onClick={() => void run('Setting the cover…', () => mediaApi.setCover(where, shownImage.name))}>
                  Make Cover
                </Button>
              )}
              <a
                className="jp-btn"
                href={mediaUrl(shownImage ? shownImage.path : viewing.kind === 'document' ? viewing.file.path : '', true)}
                download={shownImage ? shownImage.name : viewing.kind === 'document' ? viewing.file.name : undefined}
              >
                <Download size={16} aria-hidden="true" /> Download
              </a>
              <Button variant="primary" onClick={() => setViewing(null)}>
                Close
              </Button>
            </>
          )
        }
      >
        {shownImage && (
          <div className="jp-media-viewer__stage">
            {imageCount > 1 && (
              <IconButton
                icon={ChevronLeft}
                label="Previous picture"
                onClick={() => setViewing({ kind: 'image', index: (found.image.indexOf(shownImage) - 1 + imageCount) % imageCount })}
              />
            )}
            <MediaImage file={shownImage} alt={shownImage.name} className="jp-media-viewer__image" />
            {imageCount > 1 && (
              <IconButton
                icon={ChevronRight}
                label="Next picture"
                onClick={() => setViewing({ kind: 'image', index: (found.image.indexOf(shownImage) + 1) % imageCount })}
              />
            )}
          </div>
        )}
        {viewing?.kind === 'document' && <DocumentViewer file={viewing.file} />}
        {!shownImage && viewing?.kind === 'image' && <ImageIcon size={32} aria-hidden="true" />}
      </Modal>
    </section>
  );
}
