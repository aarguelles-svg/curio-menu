'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Download, Eye, EyeOff, GripVertical, ImagePlus, LoaderCircle, LogIn, LogOut, Plus, Trash2, Tv } from 'lucide-react';
import { toCanvas } from 'html-to-image';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase, tvMediaBucket } from '@/lib/supabase';
import type { MenuItem } from './menu-types';

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
type TvSettings = {
  qr_path?: string | null;
  mains_title?: string | null;
  heat_eat_title?: string | null;
};

const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const productionUrl = 'https://aarguelles-svg.github.io/curio-menu/';
const menuCountMax = 12;
const tvExportFps = 2;
const tvExportFrameDelay = 1000 / tvExportFps;

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

function drawWaveMascot(context: CanvasRenderingContext2D, mascot: CanvasImageSource) {
  const width = 205, height = 205, x = 1920 - 28 - width, y = 12;
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate(13 * Math.PI / 180);
  context.scale(-1, 1);
  context.drawImage(mascot, -width / 2, -height / 2, width, height);
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

export default function TvMenuGenerator({ mains, setMains, heatEat, setHeatEat }: {
  mains: MenuItem[];
  setMains: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  heatEat: MenuItem[];
  setHeatEat: React.Dispatch<React.SetStateAction<MenuItem[]>>;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [slides, setSlides] = useState<MediaSlide[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [mainsTitle, setMainsTitle] = useState('MAINS');
  const [heatEatTitle, setHeatEatTitle] = useState('HEAT & EAT');
  const [editingTitle, setEditingTitle] = useState<'mains' | 'heat-eat' | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
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
      supabase.from('tv_settings').select('qr_path, mains_title, heat_eat_title').eq('id', 1).maybeSingle(),
    ]);
    if (mediaError || settingsError) {
      setSetupNeeded(true);
      setMessage('Supabase needs the included one-time setup script before shared uploads can be used.');
      return;
    }
    setSetupNeeded(false);
    setSlides((media ?? []).map((row) => ({ ...(row as MediaRow), url: publicUrl((row as MediaRow).storage_path) })));
    const savedSettings = settings as TvSettings | null;
    const path = savedSettings?.qr_path ?? null;
    setQrPath(path); setQrUrl(path ? publicUrl(path) : null);
    setMainsTitle(savedSettings?.mains_title?.trim() || 'MAINS');
    setHeatEatTitle(savedSettings?.heat_eat_title?.trim() || 'HEAT & EAT');
  }, [publicUrl]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const authType = new URLSearchParams(window.location.hash.slice(1)).get('type');
    if (authType === 'recovery' || authType === 'invite') setPasswordMode(true);
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setPasswordMode(true);
    });
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

  async function requestPasswordReset() {
    if (!email.trim()) {
      setMessage('Enter your staff email first, then choose Forgot password.');
      return;
    }
    setBusy('reset'); setMessage('Sending password setup email…');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: productionUrl });
    setBusy(null);
    setMessage(error ? error.message : 'Check your email for the secure password setup link.');
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) return setMessage('Use a password with at least 8 characters.');
    if (newPassword !== confirmPassword) return setMessage('The two passwords do not match.');
    setBusy('password'); setMessage('Saving your password…');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(null);
    if (error) return setMessage(error.message);
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
    setNewPassword(''); setConfirmPassword(''); setPasswordMode(false);
    setMessage('Password saved. You are signed in and can manage shared media.');
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

  function beginTitleEdit(section: 'mains' | 'heat-eat') {
    if (!session) {
      setMessage('Sign in with a staff account to edit shared TV headers.');
      return;
    }
    setTitleDraft(section === 'mains' ? mainsTitle : heatEatTitle);
    setEditingTitle(section);
  }

  async function saveTitle(section: 'mains' | 'heat-eat') {
    const fallback = section === 'mains' ? 'MAINS' : 'HEAT & EAT';
    const nextTitle = titleDraft.trim().slice(0, 24) || fallback;
    const previousTitle = section === 'mains' ? mainsTitle : heatEatTitle;
    const column = section === 'mains' ? 'mains_title' : 'heat_eat_title';
    if (section === 'mains') setMainsTitle(nextTitle); else setHeatEatTitle(nextTitle);
    setEditingTitle(null);
    if (nextTitle === previousTitle) return;
    setMessage('Saving shared TV header…');
    const { error } = await supabase.from('tv_settings').update({ [column]: nextTitle, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) {
      if (section === 'mains') setMainsTitle(previousTitle); else setHeatEatTitle(previousTitle);
      setMessage(error.message);
      return;
    }
    setMessage('TV header saved for every device.');
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
      const waveMascot = await loadImage(`${publicBase}/assets/wave-mascot.png`);
      const encoder = GIFEncoder();
      let frameCount = 0;
      const encode = (canvas: HTMLCanvasElement, repeats = 1) => {
        const data = canvas.getContext('2d')!.getImageData(0, 0, 1920, 1080).data;
        const palette = quantize(data, 128, { format: 'rgb444', useSqrt: false });
        const indexed = applyPalette(data, palette, 'rgb444');
        for (let index = 0; index < repeats; index += 1) {
          encoder.writeFrame(indexed, 1920, 1080, { palette, delay: tvExportFrameDelay, repeat: 0 });
          frameCount += 1;
          if (frameCount === 1 || frameCount % tvExportFps === 0) setMessage(`Encoding TV frame ${frameCount}…`);
        }
      };
      const output = document.createElement('canvas'); output.width = 1920; output.height = 1080;
      const context = output.getContext('2d')!;
      const list = slides.length ? slides : [null];
      for (const slide of list) {
        if (!slide) {
          context.drawImage(base, 0, 0); drawWaveMascot(context, waveMascot);
          encode(output, tvExportFps);
          continue;
        }
        const targetFrames = Math.max(tvExportFps, Math.round(slide.duration_seconds * tvExportFps));
        if (slide.mime_type === 'image/gif') {
          const buffer = await fetch(slide.url).then((response) => response.arrayBuffer());
          const parsed = parseGIF(buffer); const decoded = decompressFrames(parsed, true);
          const source = document.createElement('canvas'); source.width = parsed.lsd.width; source.height = parsed.lsd.height;
          const sourceContext = source.getContext('2d')!;
          const sampleCount = Math.max(1, Math.min(decoded.length, targetFrames, 24));
          const chosenIndices = Array.from({ length: sampleCount }, (_, index) => Math.min(decoded.length - 1, Math.floor(index * decoded.length / sampleCount)));
          let chosenCursor = 0;
          let previousFrame: (typeof decoded)[number] | null = null;
          for (let decodedIndex = 0; decodedIndex < decoded.length && chosenCursor < chosenIndices.length; decodedIndex += 1) {
            const frame = decoded[decodedIndex];
            if (previousFrame?.disposalType === 2) sourceContext.clearRect(previousFrame.dims.left, previousFrame.dims.top, previousFrame.dims.width, previousFrame.dims.height);
            const patchBytes = new Uint8ClampedArray(frame.patch.length);
            patchBytes.set(frame.patch);
            const patch = new ImageData(patchBytes, frame.dims.width, frame.dims.height);
            sourceContext.putImageData(patch, frame.dims.left, frame.dims.top);
            previousFrame = frame;
            if (decodedIndex === chosenIndices[chosenCursor]) {
              const repeats = Math.floor(targetFrames / sampleCount) + (chosenCursor < targetFrames % sampleCount ? 1 : 0);
              context.drawImage(base, 0, 0);
              drawCover(context, source, source.width, source.height);
              drawWaveMascot(context, waveMascot);
              encode(output, repeats);
              chosenCursor += 1;
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
        } else {
          const image = await loadImage(slide.url);
          context.drawImage(base, 0, 0);
          drawCover(context, image, image.naturalWidth, image.naturalHeight);
          drawWaveMascot(context, waveMascot);
          encode(output, targetFrames);
        }
      }
      encoder.finish();
      const encodedBytes = encoder.bytes();
      const exportBuffer = new ArrayBuffer(encodedBytes.byteLength);
      new Uint8Array(exportBuffer).set(encodedBytes);
      const blob = new Blob([exportBuffer], { type: 'image/gif' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'curio-tv-menu.gif'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Exported ${frameCount} TV-compatible GIF frames at ${tvExportFps} fps.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GIF export failed.'); }
    finally { setExportTemplate(false); setBusy(null); }
  }

  const currentSlide = slides.length ? slides[activeSlide % slides.length] : null;

  return (
    <main className="app-shell tv-app-shell">
      <section className="preview-pane" aria-labelledby="tv-preview-title">
        <div className="preview-heading"><div><p className="eyebrow">Live preview</p><h1 id="tv-preview-title">TV Menu</h1></div><div className="preview-actions"><span className="size-label">1920 × 1080</span><Button className="export-button" onClick={exportGif} disabled={Boolean(busy)}>{busy === 'export' ? <LoaderCircle className="spin" /> : <Download />}{busy === 'export' ? 'Exporting…' : 'Export GIF'}</Button></div></div>
        <div className="tv-stage"><div className="tv-viewport" ref={viewportRef}><article ref={tvRef} className={`tv-canvas${exportTemplate ? ' is-export-template' : ''}`} style={{ transform: `scale(${previewScale})`, backgroundImage: `url('${publicBase}/assets/noise-bg-tv.png')` }}>
          <div className="tv-menu-card tv-main-card"><div className="tv-card-title is-editable" role="button" tabIndex={0} title="Double-click to edit" aria-label="Mains header. Double-click to edit." onDoubleClick={() => beginTitleEdit('mains')} onKeyDown={(event) => { if (event.key === 'Enter') beginTitleEdit('mains'); }}>{editingTitle === 'mains' ? <input className="tv-card-title-input" autoFocus maxLength={24} value={titleDraft} aria-label="Edit Mains header" onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle('mains')} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /> : mainsTitle}</div><div className="tv-menu-list">{mains.map((item, index) => <div className="tv-menu-row" key={item.id}><strong className={item.name ? '' : 'is-placeholder'}>{item.name || `Menu item ${index + 1}`}</strong><span className={item.price ? '' : 'is-placeholder'}>{item.price ? `P${item.price}` : 'P-'}</span></div>)}</div></div>
          <div className="tv-menu-card tv-heat-card"><div className="tv-card-title is-editable" role="button" tabIndex={0} title="Double-click to edit" aria-label="Heat and Eat header. Double-click to edit." onDoubleClick={() => beginTitleEdit('heat-eat')} onKeyDown={(event) => { if (event.key === 'Enter') beginTitleEdit('heat-eat'); }}>{editingTitle === 'heat-eat' ? <input className="tv-card-title-input" autoFocus maxLength={24} value={titleDraft} aria-label="Edit Heat and Eat header" onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle('heat-eat')} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /> : heatEatTitle}</div><div className="tv-menu-list">{heatEat.map((item, index) => <div className="tv-menu-row" key={item.id}><strong className={item.name ? '' : 'is-placeholder'}>{item.name || `Menu item ${index + 1}`}</strong><span className={item.price ? '' : 'is-placeholder'}>{item.price ? `P${item.price}` : 'P-'}</span></div>)}</div></div>
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
          {slides.length ? <div className="media-editor-list">{slides.map((slide, index) => <div className="media-editor" key={slide.id} draggable={Boolean(session)} onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (session) void moveSlide(Number(event.dataTransfer.getData('text/plain')), index); }}><GripVertical className="media-grip" /><button className="media-thumb" onClick={() => setActiveSlide(index)}><img src={slide.url} alt="" /></button><div className="media-meta"><strong title={slide.file_name}>{slide.file_name}</strong><label><Input type="number" min="1" max="300" value={slide.duration_seconds} disabled={!session} onChange={(event) => void updateSlide(slide.id, { duration_seconds: Math.min(300, Math.max(1, Number(event.target.value))) })} /><span>sec</span></label></div>{session && <Button variant="ghost" size="icon-sm" className="delete-button" disabled={busy === slide.id} onClick={() => void removeSlide(slide)}><Trash2 /></Button>}</div>)}</div> : session ? <button className="empty-library is-upload-ready" type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'upload'}><ImagePlus /><strong>Upload your first offer</strong><span>PNG, JPG, WebP, or GIF · up to 25 MB</span></button> : <div className="empty-library">No offer media yet. Sign in below to add the first slide.</div>}
        </section>
        <section className="settings-section"><div className="section-heading"><div><h3>QR code</h3><p>Displayed beside the fixed @curio.eats handle</p></div>{session && <Button variant="outline" onClick={() => qrRef.current?.click()} disabled={busy === 'qr'}>{qrUrl ? 'Replace' : 'Upload'}</Button>}</div><input ref={qrRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadQr(file); event.currentTarget.value = ''; }} />{qrUrl && <img className="qr-preview" src={qrUrl} alt="Uploaded QR code" />}</section>
        <section className="settings-section auth-section">{session && passwordMode ? <form onSubmit={updatePassword}><div className="section-heading"><div><h3>Set your staff password</h3><p>Create the password you’ll use on the live generator</p></div></div><label><span>New password</span><div className="password-control"><Input type={showPassword ? 'text' : 'password'} minLength={8} required autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label><label><span>Confirm password</span><div className="password-control"><Input type={showPassword ? 'text' : 'password'} minLength={8} required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label><Button className="auth-button" type="submit" disabled={busy === 'password'}>{busy === 'password' ? <LoaderCircle className="spin" /> : <LogIn />}{busy === 'password' ? 'Saving…' : 'Save password'}</Button></form> : session ? <div className="signed-in"><div><h3>Staff account</h3><p>{session.user.email}</p></div><Button variant="outline" onClick={() => void supabase.auth.signOut()}><LogOut /> Sign out</Button></div> : <form onSubmit={signIn}><div className="section-heading"><div><h3>Staff sign in</h3><p>Required to change shared media and TV headers</p></div></div><label><span>Email</span><Input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label><span>Password</span><div className="password-control"><Input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label><div className="auth-actions"><Button className="auth-button" type="submit" disabled={busy === 'auth'}><LogIn /> Sign in</Button><button className="forgot-password" type="button" disabled={busy === 'reset'} onClick={() => void requestPasswordReset()}>{busy === 'reset' ? 'Sending…' : 'Forgot password?'}</button></div></form>}</section>
      </div></aside>
    </main>
  );
}
