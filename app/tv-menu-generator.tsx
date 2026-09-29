'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Download, GripVertical, ImagePlus, LoaderCircle, LogIn, LogOut, Plus, Trash2, Tv } from 'lucide-react';
import { toCanvas } from 'html-to-image';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase, tvMediaBucket } from '@/lib/supabase';

type MenuItem = { id: number; name: string; price: string };
type MediaRow = {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  duration_seconds: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
};
type MediaSlide = MediaRow & { url: string };

const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const menuCountMax = 12;
const blankItems = () => Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: '', price: '' }));

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function waitFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load an uploaded image for export.'));
    image.src = url;
  });
}

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  const x = 1342, y = 127, width = 481, height = 614, radius = 30;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.clip();
  context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

function ItemEditor({ title, items, setItems }: { title: string; items: MenuItem[]; setItems: React.Dispatch<React.SetStateAction<MenuItem[]>> }) {
  const [dragged, setDragged] = useState<number | null>(null);
  const nextId = useMemo(() => Math.max(0, ...items.map((item) => item.id)) + 1, [items]);
  const update = (id: number, field: 'name' | 'price', value: string) => setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  const setCount = (count: number) => setItems((current) => count <= current.length ? current.slice(0, count) : [...current, ...Array.from({ length: count - current.length }, (_, index) => ({ id: Math.max(0, ...current.map((item) => item.id)) + index + 1, name: '', price: '' }))]);

  return (
    <section className="settings-section tv-menu-editor">
      <div className="section-heading"><div><h3>{title}</h3><select className="item-count-select" value={items.length} onChange={(event) => setCount(Number(event.target.value))} aria-label={`${title} item count`}>{Array.from({ length: menuCountMax }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? 'item' : 'items'}</option>)}</select></div></div>
      <div className="item-editor-list">
        {items.map((item, index) => (
          <div className={`item-editor${dragged === index ? ' is-dragging' : ''}`} key={item.id} onDragOver={(event) => event.preventDefault()} onDrop={() => {
            if (dragged === null || dragged === index) return setDragged(null);
            setItems((current) => { const copy = [...current]; const [moved] = copy.splice(dragged, 1); copy.splice(index, 0, moved); return copy; });
            setDragged(null);
          }}>
            <button className="drag-handle" draggable aria-label={`Drag ${title} item ${index + 1}`} onDragStart={() => setDragged(index)} onDragEnd={() => setDragged(null)}><GripVertical /></button>
            <div className="item-fields">
              <Input value={item.name} placeholder="Item name" onChange={(event) => update(item.id, 'name', event.target.value)} />
              <label className="price-field"><span className="price-prefix">P</span><Input className="price-input" inputMode="numeric" value={item.price} placeholder="0" onChange={(event) => update(item.id, 'price', event.target.value.replace(/\D/g, ''))} /></label>
            </div>
            <div className="item-actions"><Button variant="ghost" size="icon-sm" className="delete-button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 /></Button></div>
          </div>
        ))}
        <button className="add-item-row" disabled={items.length >= menuCountMax} onClick={() => setItems((current) => [...current, { id: nextId, name: '', price: '' }])}><span className="add-item-tab"><Plus /></span><span>{items.length >= menuCountMax ? 'Maximum 12 items' : `Add to ${title}`}</span></button>
      </div>
    </section>
  );
}

export default function TvMenuGenerator() {
  const [mains, setMains] = useState<MenuItem[]>(blankItems);
  const [heatEat, setHeatEat] = useState<MenuItem[]>(blankItems);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [slides, setSlides] = useState<MediaSlide[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [exportTemplate, setExportTemplate] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tvRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLInputElement>(null);

  const publicUrl = useCallback((path: string) => supabase.storage.from(tvMediaBucket).getPublicUrl(path).data.publicUrl, []);
  const loadLibrary = useCallback(async () => {
    const [{ data: media, error: mediaError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from('tv_media').select('*').order('sort_order').order('created_at'),
      supabase.from('tv_settings').select('qr_path').eq('id', 1).maybeSingle(),
    ]);
    if (mediaError || settingsError) {
      setSetupNeeded(true);
      setMessage('Supabase needs the included one-time setup script before shared uploads can be used.');
      return;
    }
    setSetupNeeded(false);
    setSlides((media ?? []).map((row) => ({ ...(row as MediaRow), url: publicUrl((row as MediaRow).storage_path) })));
    const path = (settings as { qr_path?: string | null } | null)?.qr_path ?? null;
    setQrPath(path); setQrUrl(path ? publicUrl(path) : null);
  }, [publicUrl]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    void loadLibrary();
    return () => data.subscription.unsubscribe();
  }, [loadLibrary]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setPreviewScale(Math.min(viewport.clientWidth / 1920, viewport.clientHeight / 1080));
    resize(); const observer = new ResizeObserver(resize); observer.observe(viewport); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (slides.length < 2 || busy === 'export') return;
    const slide = slides[activeSlide % slides.length];
    const timeout = window.setTimeout(() => setActiveSlide((current) => (current + 1) % slides.length), Math.max(1, slide.duration_seconds) * 1000);
    return () => window.clearTimeout(timeout);
  }, [activeSlide, slides, busy]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy('auth'); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(null); setMessage(error ? error.message : 'Signed in. Uploads are now enabled.'); if (!error) setPassword('');
  }

  async function uploadMedia(file: File) {
    if (!session) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return setMessage('Use a PNG, JPG, WebP, or GIF file.');
    if (file.size > 25 * 1024 * 1024) return setMessage('Media must be 25 MB or smaller.');
    setBusy('upload'); setMessage('Uploading media…');
    const path = `slides/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(tvMediaBucket).upload(path, file, { contentType: file.type });
    if (uploadError) { setBusy(null); return setMessage(uploadError.message); }
    const { error } = await supabase.from('tv_media').insert({ storage_path: path, file_name: file.name, mime_type: file.type, duration_seconds: 10, sort_order: slides.length, created_by: session.user.id });
    if (error) await supabase.storage.from(tvMediaBucket).remove([path]);
    setBusy(null); setMessage(error ? error.message : 'Media added to the shared library.'); await loadLibrary();
  }

  async function uploadQr(file: File) {
    if (!session) return;
    if (!file.type.startsWith('image/')) return setMessage('Please upload an image for the QR code.');
    setBusy('qr'); const path = `qr/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(tvMediaBucket).upload(path, file, { contentType: file.type });
    if (uploadError) { setBusy(null); return setMessage(uploadError.message); }
    const { error } = await supabase.from('tv_settings').update({ qr_path: path, updated_at: new Date().toISOString() }).eq('id', 1);
    if (!error && qrPath) await supabase.storage.from(tvMediaBucket).remove([qrPath]);
    setBusy(null); setMessage(error ? error.message : 'QR code updated for every device.'); await loadLibrary();
  }

  async function updateSlide(id: string, patch: Partial<Pick<MediaRow, 'duration_seconds' | 'sort_order'>>) {
    setSlides((current) => current.map((slide) => slide.id === id ? { ...slide, ...patch } : slide));
    const { error } = await supabase.from('tv_media').update(patch).eq('id', id);
    if (error) { setMessage(error.message); await loadLibrary(); }
  }

  async function moveSlide(from: number, to: number) {
    if (from === to || to < 0 || to >= slides.length) return;
    const reordered = [...slides]; const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved);
    setSlides(reordered.map((slide, index) => ({ ...slide, sort_order: index })));
    const results = await Promise.all(reordered.map((slide, index) => supabase.from('tv_media').update({ sort_order: index }).eq('id', slide.id)));
    if (results.some(({ error }) => error)) { setMessage('Could not save the new order.'); await loadLibrary(); }
  }

  async function removeSlide(slide: MediaSlide) {
    setBusy(slide.id);
    const { error } = await supabase.from('tv_media').delete().eq('id', slide.id);
    if (!error) await supabase.storage.from(tvMediaBucket).remove([slide.storage_path]);
    setBusy(null); setMessage(error ? error.message : 'Slide removed.'); await loadLibrary();
  }

  async function exportGif() {
    if (!tvRef.current || busy) return;
    setBusy('export'); setMessage('Preparing the fixed menu artwork…'); setExportTemplate(true);
    try {
      await document.fonts.ready; await waitFrame();
      const base = await toCanvas(tvRef.current, { width: 1920, height: 1080, pixelRatio: 1, cacheBust: true, style: { transform: 'none' } });
      const encoder = GIFEncoder();
      let frameCount = 0;
      const encode = (canvas: HTMLCanvasElement, delay: number) => {
        const data = canvas.getContext('2d')!.getImageData(0, 0, 1920, 1080).data;
        const palette = quantize(data, 128, { format: 'rgb444', useSqrt: false });
        encoder.writeFrame(applyPalette(data, palette, 'rgb444'), 1920, 1080, { palette, delay, repeat: 0 });
        frameCount += 1; setMessage(`Encoding frame ${frameCount}…`);
      };
      const output = document.createElement('canvas'); output.width = 1920; output.height = 1080;
      const context = output.getContext('2d')!;
      const list = slides.length ? slides : [null];
      for (const slide of list) {
        if (!slide) { context.drawImage(base, 0, 0); encode(output, 1000); continue; }
        if (slide.mime_type === 'image/gif') {
          const buffer = await fetch(slide.url).then((response) => response.arrayBuffer());
          const parsed = parseGIF(buffer); const decoded = decompressFrames(parsed, true);
          const source = document.createElement('canvas'); source.width = parsed.lsd.width; source.height = parsed.lsd.height;
          const sourceContext = source.getContext('2d')!;
          const chosen = decoded.length > 24 ? decoded.filter((_frame, index) => index % Math.ceil(decoded.length / 24) === 0).slice(0, 24) : decoded;
          const delay = slide.duration_seconds * 1000 / Math.max(1, chosen.length);
          for (const frame of chosen) {
            const patchBytes = new Uint8ClampedArray(frame.patch.length);
            patchBytes.set(frame.patch);
            const patch = new ImageData(patchBytes, frame.dims.width, frame.dims.height);
            if (frame.disposalType === 2) sourceContext.clearRect(0, 0, source.width, source.height);
            sourceContext.putImageData(patch, frame.dims.left, frame.dims.top);
            context.drawImage(base, 0, 0); drawCover(context, source, source.width, source.height); encode(output, delay);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else {
          const image = await loadImage(slide.url); context.drawImage(base, 0, 0); drawCover(context, image, image.naturalWidth, image.naturalHeight); encode(output, slide.duration_seconds * 1000);
        }
      }
      encoder.finish();
      const encodedBytes = encoder.bytes();
      const exportBuffer = new ArrayBuffer(encodedBytes.byteLength);
      new Uint8Array(exportBuffer).set(encodedBytes);
      const blob = new Blob([exportBuffer], { type: 'image/gif' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'curio-tv-menu.gif'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Exported ${frameCount} GIF frame${frameCount === 1 ? '' : 's'}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GIF export failed.'); }
    finally { setExportTemplate(false); setBusy(null); }
  }

  const currentSlide = slides.length ? slides[activeSlide % slides.length] : null;

  return (
    <main className="app-shell tv-app-shell">
      <section className="preview-pane" aria-labelledby="tv-preview-title">
        <div className="preview-heading"><div><p className="eyebrow">Live preview</p><h1 id="tv-preview-title">TV Menu</h1></div><div className="preview-actions"><span className="size-label">1920 × 1080</span><Button className="export-button" onClick={exportGif} disabled={Boolean(busy)}>{busy === 'export' ? <LoaderCircle className="spin" /> : <Download />}{busy === 'export' ? 'Exporting…' : 'Export GIF'}</Button></div></div>
        <div className="tv-stage"><div className="tv-viewport" ref={viewportRef}><article ref={tvRef} className={`tv-canvas${exportTemplate ? ' is-export-template' : ''}`} style={{ transform: `scale(${previewScale})`, backgroundImage: `url('${publicBase}/assets/noise-bg.png')` }}>
          <div className="tv-menu-card tv-main-card"><div className="tv-card-title">MAINS</div><div className="tv-menu-list">{mains.map((item, index) => <div className="tv-menu-row" key={item.id}><strong className={item.name ? '' : 'is-placeholder'}>{item.name || `Menu item ${index + 1}`}</strong><span className={item.price ? '' : 'is-placeholder'}>{item.price ? `P${item.price}` : 'P-'}</span></div>)}</div></div>
          <div className="tv-menu-card tv-heat-card"><div className="tv-card-title">HEAT &amp; EAT</div><div className="tv-menu-list">{heatEat.map((item, index) => <div className="tv-menu-row" key={item.id}><strong className={item.name ? '' : 'is-placeholder'}>{item.name || `Menu item ${index + 1}`}</strong><span className={item.price ? '' : 'is-placeholder'}>{item.price ? `P${item.price}` : 'P-'}</span></div>)}</div></div>
          <div className="tv-media-card"><div className="tv-media-inner">{currentSlide && <img src={currentSlide.url} alt={currentSlide.file_name} />}{!currentSlide && <div className="tv-media-empty">Your offers<br />will appear here</div>}</div></div>
          <div className="tv-social-card"><div className="tv-social-copy">Follow us<br />for updates!<br /><strong>@curio.eats</strong></div><div className="tv-qr-box">{qrUrl ? <img src={qrUrl} alt="Curio QR code" /> : <span>Upload<br />QR code</span>}</div></div>
          <img className="tv-wave-mascot" src={`${publicBase}/assets/wave-mascot.png`} alt="" /><img className="tv-point-mascot" src={`${publicBase}/assets/point-mascot.png`} alt="" />
        </article></div></div>
      </section>
      <aside className="editor-pane"><div className="editor-header"><div className="editor-icon"><Tv /></div><div><p className="eyebrow">TV generator</p><h2>Build the screen menu</h2></div></div><div className="editor-scroll">
        {message && <div className={`status-message${setupNeeded ? ' is-warning' : ''}`}>{message}</div>}
        <ItemEditor title="Mains" items={mains} setItems={setMains} />
        <ItemEditor title="Heat & Eat" items={heatEat} setItems={setHeatEat} />
        <section className="settings-section"><div className="section-heading"><div><h3>Offer slideshow</h3><p>Shared media saved in Supabase</p></div>{session && <Button className="add-button" onClick={() => fileRef.current?.click()} disabled={busy === 'upload'}><ImagePlus /> Add media</Button>}</div>
          <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadMedia(file); event.currentTarget.value = ''; }} />
          {slides.length ? <div className="media-editor-list">{slides.map((slide, index) => <div className="media-editor" key={slide.id} draggable={Boolean(session)} onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (session) void moveSlide(Number(event.dataTransfer.getData('text/plain')), index); }}><GripVertical className="media-grip" /><button className="media-thumb" onClick={() => setActiveSlide(index)}><img src={slide.url} alt="" /></button><div className="media-meta"><strong title={slide.file_name}>{slide.file_name}</strong><label><Input type="number" min="1" max="300" value={slide.duration_seconds} disabled={!session} onChange={(event) => void updateSlide(slide.id, { duration_seconds: Math.min(300, Math.max(1, Number(event.target.value))) })} /><span>sec</span></label></div>{session && <Button variant="ghost" size="icon-sm" className="delete-button" disabled={busy === slide.id} onClick={() => void removeSlide(slide)}><Trash2 /></Button>}</div>)}</div> : <div className="empty-library">No offer media yet. Sign in to add the first slide.</div>}
        </section>
        <section className="settings-section"><div className="section-heading"><div><h3>QR code</h3><p>Displayed beside the fixed @curio.eats handle</p></div>{session && <Button variant="outline" onClick={() => qrRef.current?.click()} disabled={busy === 'qr'}>{qrUrl ? 'Replace' : 'Upload'}</Button>}</div><input ref={qrRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadQr(file); event.currentTarget.value = ''; }} />{qrUrl && <img className="qr-preview" src={qrUrl} alt="Uploaded QR code" />}</section>
        <section className="settings-section auth-section">{session ? <div className="signed-in"><div><h3>Media account</h3><p>{session.user.email}</p></div><Button variant="outline" onClick={() => void supabase.auth.signOut()}><LogOut /> Sign out</Button></div> : <form onSubmit={signIn}><div className="section-heading"><div><h3>Staff sign in</h3><p>Required only to change shared media</p></div></div><label><span>Email</span><Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label><span>Password</span><Input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><Button className="auth-button" type="submit" disabled={busy === 'auth'}><LogIn /> Sign in</Button></form>}</section>
      </div></aside>
    </main>
  );
}
