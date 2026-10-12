import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, ChevronLeft, ChevronRight, Download, ImagePlus, Maximize2, Star, Trash2 } from 'lucide-react';
import { uploadFile, uploads, type UploadInfo } from '../api';
import { Button, IconButton, cx } from '../components/Button';
import { Modal } from '../components/Overlay';
import { onServerEvent, showMessage } from '../page';
import { useCan } from '../session';
import { joinFolder } from '../upload/plan';
import { MediaImage } from './MediaViews';
import { EMPTY_MEDIA, media as mediaApi, mediaUrl, type MediaFile, type ModelMedia } from './media';

/** One picture of the gallery: a photo from the model folder's image folder, or a 3D render. */
export type GalleryItem = { kind: 'photo'; file: MediaFile; cover: boolean } | { kind: 'render'; src: string };

/** The gallery's pictures: the photos (the cover first), then the renders. */
export function galleryItems(found: Pick<ModelMedia, 'image' | 'cover'>, renders: string[]): GalleryItem[] {
  const photos = [...found.image].sort((a, b) => Number(b.name === found.cover) - Number(a.name === found.cover));
  return [
    ...photos.map((file): GalleryItem => ({ kind: 'photo', file, cover: file.name === found.cover })),
    ...renders.filter((src) => src && src !== '3d.png').map((src): GalleryItem => ({ kind: 'render', src }))
  ];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Picture({ item, className }: { item: GalleryItem; className?: string }) {
  return item.kind === 'photo' ? (
    <MediaImage file={item.file} alt={item.file.name} className={className} />
  ) : (
    <img src={item.src} alt="" className={className} draggable={false} />
  );
}

/**
 * The model page's gallery: every photo in the model folder's image folder (the cover first), then
 * the 3D renders of this file; a click on the large picture shows it full size. Editors add photos
 * (a model alone in its folder gets a model folder for them), remove them and choose the cover.
 * `renders` are this file's own pictures without the cover; `folder` its folder.
 */
export function ModelGallery({
  filePath,
  folder,
  renders,
  online,
  alone
}: {
  filePath: string;
  folder: string | null;
  renders: string[];
  online: boolean;
  alone: boolean;
}) {
  const canEdit = useCan('editor');
  const [found, setFound] = useState<ModelMedia>(EMPTY_MEDIA);
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const info = useRef<UploadInfo | null>(null);

  const load = useCallback(() => {
    if (!folder) return;
    mediaApi.get(folder).then(setFound, () => setFound(EMPTY_MEDIA));
  }, [folder]);

  useEffect(() => {
    load();
    return onServerEvent('folder-changed', load);
  }, [load]);

  useEffect(() => {
    if (canEdit)
      uploads.info().then(
        (result) => (info.current = result),
        () => {}
      );
  }, [canEdit]);

  const items = galleryItems(found, renders);
  const at = items.length ? Math.min(index, items.length - 1) : 0;
  const shown = items[at] || null;
  const where = found.folder || folder;
  // Photos need a model folder; a model alone in its folder gets one on the first photo.
  const canAdd = canEdit && !online && !!folder && (found.isModelFolder || alone);

  async function run(label: string, work: () => Promise<ModelMedia | void>) {
    setBusy(label);
    try {
      const next = await work();
      if (next) setFound(next);
    } catch (error) {
      await showMessage('Gallery', errorText(error));
    } finally {
      setBusy('');
    }
  }

  async function addPhotos(files: File[]) {
    if (!folder) return;
    await run('Adding…', async () => {
      if (!found.isModelFolder) await mediaApi.register(folder);
      const target = joinFolder(where || folder, 'image');
      const paths: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading ${files[i].name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}…`);
        try {
          paths.push((await uploadFile(files[i], target, { chunkBytes: info.current?.chunkBytes || 16 * 1024 * 1024 })).filePath);
        } catch (error) {
          failed.push(`${files[i].name}: ${errorText(error)}`);
        }
      }
      if (paths.length) await uploads.finish(target, paths);
      if (failed.length) await showMessage('Not added', failed.join('\n'));
      setIndex(0);
      return mediaApi.get(where || folder);
    });
  }

  async function removePhoto(file: MediaFile) {
    const answer = await showMessage('Remove Photo', `Move ${file.name} to the Trash?`, ['Move to Trash', 'Cancel']);
    if (answer !== 'Move to Trash' || !where) return;
    setFull(false);
    await run('Removing…', () => mediaApi.remove(where, 'image', file.name));
  }

  const step = (by: number) => setIndex((now) => (items.length ? (Math.min(now, items.length - 1) + by + items.length) % items.length : 0));

  const photoTools = (item: GalleryItem | null) =>
    item?.kind === 'photo' &&
    canEdit &&
    found.isModelFolder &&
    where && (
      <span className="jp-gallery__tools">
        {!item.cover && (
          <IconButton
            icon={Star}
            size="sm"
            label={`Make ${item.file.name} the cover`}
            disabled={!!busy}
            onClick={() => void run('Setting the cover…', () => mediaApi.setCover(where, item.file.name))}
          />
        )}
        <IconButton icon={Trash2} size="sm" label={`Remove ${item.file.name}`} disabled={!!busy} onClick={() => void removePhoto(item.file)} />
      </span>
    );

  return (
    <div className="jp-model-page__gallery" id="jp-model-gallery">
      <div className="jp-model-page__stage">
        {shown ? (
          <button type="button" className="jp-gallery__open" title="Show it full size" onClick={() => setFull(true)}>
            <Picture item={shown} />
          </button>
        ) : (
          <img src="3d.png" alt="" draggable={false} />
        )}
        {shown?.kind === 'photo' && shown.cover && <span className="jp-media__badge jp-gallery__cover">Cover</span>}
        {photoTools(shown)}
        {shown && (
          <button type="button" className="jp-details__overlay-btn jp-gallery__full" title="Show it full size" onClick={() => setFull(true)}>
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        )}
        {!online && (
          <button
            type="button"
            className="jp-details__overlay-btn jp-model-page__3d"
            title="Open the 3D preview"
            onClick={() => void window.openPreview?.(filePath)}
          >
            <Box size={16} aria-hidden="true" />
            <span>3D</span>
          </button>
        )}
      </div>
      {(items.length > 1 || canAdd) && (
        <div className="jp-gallery__row">
          <div className="jp-details__strip">
            <div className="jp-gallery__options" role="listbox" aria-label="Pictures" aria-orientation="horizontal">
              {items.map((item, i) => (
                <button
                  key={item.kind === 'photo' ? item.file.name : `render-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === at}
                  aria-label={item.kind === 'photo' ? item.file.name : `3D render ${i + 1}`}
                  className={cx('jp-details__thumb', i === at && 'is-selected')}
                  onClick={() => setIndex(i)}
                >
                  <Picture item={item} />
                </button>
              ))}
            </div>
            {/* Not a picture to choose: after the list, at the end of the strip. */}
            {canAdd && (
              <button
                type="button"
                className="jp-details__thumb jp-gallery__add"
                id="jp-gallery-add"
                title="Add photos"
                aria-label="Add photos"
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                <ImagePlus size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          {canAdd && (
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept={(info.current?.mediaExtensions?.image || []).join(',')}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = '';
                if (files.length) void addPhotos(files);
              }}
            />
          )}
          {busy && <span className="jp-meta jp-gallery__busy">{busy}</span>}
        </div>
      )}

      <Modal
        open={full && !!shown}
        onClose={() => setFull(false)}
        title={shown?.kind === 'photo' ? shown.file.name : '3D render'}
        className="jp-media-viewer"
        footer={
          shown && (
            <>
              {shown.kind === 'photo' && (
                <a className="jp-btn" href={mediaUrl(shown.file.path, true)} download={shown.file.name}>
                  <Download size={16} aria-hidden="true" /> Download
                </a>
              )}
              <Button variant="primary" onClick={() => setFull(false)}>
                Close
              </Button>
            </>
          )
        }
      >
        {shown && (
          <div className="jp-media-viewer__stage">
            {items.length > 1 && <IconButton icon={ChevronLeft} label="Previous picture" onClick={() => step(-1)} />}
            <Picture item={shown} className="jp-media-viewer__image" />
            {items.length > 1 && <IconButton icon={ChevronRight} label="Next picture" onClick={() => step(1)} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
