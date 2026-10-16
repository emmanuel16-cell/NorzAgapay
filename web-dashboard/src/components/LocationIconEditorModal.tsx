import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ImagePlus, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

type LocationIconEditorModalProps = {
  title: string;
  currentIconUrl?: string | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
};

const FRAME_SIZE = 280;
const EXPORT_SIZE = 512;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export default function LocationIconEditorModal({ title, currentIconUrl, saving = false, onClose, onSave, onRemove }: LocationIconEditorModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageSize, setImageSize] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  useEffect(() => () => { if (sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  const onChooseFile = (file?: File) => {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Choose a PNG, JPG, or WebP image.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError('Choose an image smaller than 12 MB.'); return; }
    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setImageSize(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const baseScale = imageSize ? Math.max(FRAME_SIZE / imageSize[0], FRAME_SIZE / imageSize[1]) : 1;
  const minZoom = 0.5;
  const renderedWidth = imageSize ? imageSize[0] * baseScale * zoom : FRAME_SIZE;
  const renderedHeight = imageSize ? imageSize[1] * baseScale * zoom : FRAME_SIZE;
  const moveImage = (x: number, y: number) => {
    setOffset({
      x: renderedWidth <= FRAME_SIZE ? 0 : Math.max((FRAME_SIZE - renderedWidth) / 2, Math.min((renderedWidth - FRAME_SIZE) / 2, x)),
      y: renderedHeight <= FRAME_SIZE ? 0 : Math.max((FRAME_SIZE - renderedHeight) / 2, Math.min((renderedHeight - FRAME_SIZE) / 2, y)),
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: renderedWidth <= FRAME_SIZE ? 0 : offset.x, offsetY: renderedHeight <= FRAME_SIZE ? 0 : offset.y };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    moveImage(drag.offsetX + event.clientX - drag.x, drag.offsetY + event.clientY - drag.y);
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const saveEditedImage = async () => {
    if (!imageRef.current || !imageSize) { setError('Choose an image before saving.'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) { setError('Your browser could not prepare this image.'); return; }
    const scale = Math.max(EXPORT_SIZE / imageSize[0], EXPORT_SIZE / imageSize[1]) * zoom;
    const width = imageSize[0] * scale;
    const height = imageSize[1] * scale;
    const x = (EXPORT_SIZE - width) / 2 + (width <= EXPORT_SIZE ? 0 : offset.x * EXPORT_SIZE / FRAME_SIZE);
    const y = (EXPORT_SIZE - height) / 2 + (height <= EXPORT_SIZE ? 0 : offset.y * EXPORT_SIZE / FRAME_SIZE);
    context.drawImage(imageRef.current, x, y, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { setError('The edited image could not be created.'); return; }
    if (blob.size > 2 * 1024 * 1024) { setError('The edited icon is over 2 MB. Zoom out or use a smaller source image.'); return; }
    await onSave(new File([blob], 'location-icon.png', { type: 'image/png' }));
  };

  const previewUrl = sourceUrl || currentIconUrl || '';
  const hasEditedSource = Boolean(sourceUrl && imageSize);

  return <div className="location-icon-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="location-icon-modal" role="dialog" aria-modal="true" aria-labelledby="location-icon-modal-title">
      <header className="location-icon-modal-header"><div><span className="location-icon-modal-symbol"><ImagePlus size={19} /></span><div><h2 id="location-icon-modal-title">{title}</h2><p>Position and zoom the image. It will appear as the map pin.</p></div></div><button type="button" onClick={onClose} disabled={saving} aria-label="Close image editor"><X size={19} /></button></header>
      <div className="location-icon-modal-body">
        <div className="location-icon-crop-frame" style={{ width: FRAME_SIZE, height: FRAME_SIZE }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          {sourceUrl && <img ref={imageRef} src={sourceUrl} alt="Image being positioned for the map icon" onLoad={(event) => setImageSize([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])} style={{ width: renderedWidth, height: renderedHeight, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} />}
          {!sourceUrl && previewUrl ? <img className="location-icon-current-preview" src={previewUrl} alt="Current map icon" /> : null}
          {!previewUrl && <div className="location-icon-empty-preview"><ImagePlus size={33} /><span>Choose an image</span></div>}
          <span className="location-icon-crop-guide" aria-hidden="true" />
        </div>
        <p className="location-icon-editor-hint">Drag the image to center it inside the circle.</p>
        <div className="location-icon-editor-controls">
          <button type="button" onClick={() => { setZoom((value) => Math.max(minZoom, Number((value - 0.1).toFixed(2)))); setOffset({ x: 0, y: 0 }); }} disabled={!hasEditedSource || zoom <= minZoom} aria-label="Zoom out"><ZoomOut size={17} /></button>
          <input aria-label="Zoom image" type="range" min={minZoom} max="3" step="0.05" value={zoom} disabled={!hasEditedSource} onChange={(event) => { const next = Number(event.target.value); setZoom(next); setOffset({ x: 0, y: 0 }); }} />
          <button type="button" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.1).toFixed(2))))} disabled={!hasEditedSource || zoom >= 3} aria-label="Zoom in"><ZoomIn size={17} /></button>
          <button type="button" className="location-icon-reset" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} disabled={!hasEditedSource}><RotateCcw size={15} /> Center</button>
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { onChooseFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
        <div className="location-icon-modal-actions"><button className="location-icon-choose" type="button" onClick={() => inputRef.current?.click()} disabled={saving}><ImagePlus size={16} />{sourceUrl ? 'Choose another image' : currentIconUrl ? 'Replace icon' : 'Add icon'}</button>{onRemove && currentIconUrl && <button className="location-icon-remove" type="button" onClick={() => void onRemove()} disabled={saving}>Remove icon</button>}</div>
        <p className="location-icon-file-note">PNG, JPG, or WebP · edited image up to 2 MB</p>
        {error && <p className="location-icon-error" role="alert">{error}</p>}
      </div>
      <footer className="location-icon-modal-footer"><button type="button" className="location-icon-cancel" onClick={onClose} disabled={saving}>Cancel</button><button type="button" className="location-icon-save" onClick={() => void saveEditedImage()} disabled={!hasEditedSource || saving}>{saving ? 'Saving…' : 'Save icon'}</button></footer>
    </section>
  </div>;
}
