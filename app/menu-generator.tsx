'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, GripVertical, LoaderCircle, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type MenuItem = { id: number; name: string; price: string };
const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const initialItems: MenuItem[] = [
  { id: 1, name: 'Chicken Inasal', price: 'P380' },
  { id: 2, name: 'Beef Caldereta', price: 'P420' },
  { id: 3, name: 'Pork Adobo', price: 'P360' },
  { id: 4, name: 'Crispy Bangus', price: 'P395' },
  { id: 5, name: 'Laing', price: 'P260' },
  { id: 6, name: 'Garlic Rice', price: 'P120' },
  { id: 7, name: 'Leche Flan', price: 'P180' },
  { id: 8, name: 'Calamansi Juice', price: 'P140' },
];

function formatToday() {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(new Date());
}

export default function Home() {
  const [items, setItems] = useState(initialItems);
  const [date, setDate] = useState(formatToday);
  const [category, setCategory] = useState('MAINS');
  const [phone, setPhone] = useState('+63 917 102 0722');
  const [previewScale, setPreviewScale] = useState(1);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const nextId = useMemo(() => Math.max(0, ...items.map((item) => item.id)) + 1, [items]);
  const storyItemCount = Math.max(items.length, 1);
  const menuHeight = 172 + storyItemCount * 112;
  const cardTop = 346 - (menuHeight - 1068) / 2;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setPreviewScale(viewport.clientWidth / 1080);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: 'set_daily_menu',
      title: 'Set daily menu',
      description: 'Replace the visible story details and menu items in one action.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string' }, category: { type: 'string' }, phone: { type: 'string' },
          items: { type: 'array', minItems: 1, items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'string' } }, required: ['name', 'price'], additionalProperties: false } },
        },
        required: ['date', 'category', 'phone', 'items'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { date?: unknown; category?: unknown; phone?: unknown; items?: unknown };
        if (typeof value.date !== 'string' || typeof value.category !== 'string' || typeof value.phone !== 'string' || !Array.isArray(value.items) || !value.items.length) throw new Error('Provide date, category, phone, and at least one menu item.');
        const normalized = value.items.map((entry, index) => {
          const item = entry as { name?: unknown; price?: unknown };
          if (typeof item.name !== 'string' || typeof item.price !== 'string') throw new Error(`Menu item ${index + 1} needs a name and price.`);
          return { id: index + 1, name: item.name, price: item.price };
        });
        setDate(value.date); setCategory(value.category); setPhone(value.phone); setItems(normalized);
        return { status: 'updated', itemCount: normalized.length };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function updateItem(id: number, field: 'name' | 'price', value: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    setItems((current) => {
      const updated = [...current];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);
      return updated;
    });
  }

  function addItem() {
    setItems((current) => [...current, { id: nextId, name: `Menu Item ${current.length + 1}`, price: 'Pxxx' }]);
  }

  async function exportPng() {
    if (!storyRef.current || isExporting) return;
    setIsExporting(true);
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(storyRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 1,
        cacheBust: true,
        style: { transform: 'none' },
      });
      const link = document.createElement('a');
      link.download = `${(date || 'daily').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-menu.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="preview-pane" aria-labelledby="preview-title">
        <div className="preview-heading">
          <div><p className="eyebrow">Live preview</p><h1 id="preview-title">Instagram Story</h1></div>
          <div className="preview-actions">
            <span className="size-label">1080 × 1920</span>
            <Button className="export-button" onClick={exportPng} disabled={isExporting}>
              {isExporting ? <LoaderCircle className="spin" /> : <Download />} {isExporting ? 'Exporting…' : 'Export PNG'}
            </Button>
          </div>
        </div>
        <div className="story-stage">
          <div className="story-viewport" ref={viewportRef}>
          <article
            ref={storyRef}
            className="story"
            style={{
              transform: `scale(${previewScale})`,
              '--item-count': storyItemCount,
              '--menu-height': `${menuHeight}px`,
              '--card-top': `${cardTop}px`,
              backgroundImage: `url('${publicBase}/assets/noise-bg.png')`,
            } as React.CSSProperties}
            aria-label="Generated daily menu preview"
          >
            <div className="menu-card">
              <div className="menu-title"><span>{date || '[DATE]'} MENU</span><strong>{category || 'MAINS'}</strong></div>
              <img className="wave-mascot" src={`${publicBase}/assets/wave-mascot.png`} alt="Waving mascot" />
              <div className="menu-list">
                {items.length ? items.map((item) => (
                  <div className="story-menu-row" key={item.id}>
                    <span>{item.name || 'Untitled item'}</span><em>{item.price || '—'}</em>
                  </div>
                )) : <div className="empty-menu">Add your first menu item</div>}
              </div>
            </div>
            <img className="point-mascot" src={`${publicBase}/assets/point-mascot.png`} alt="Pointing mascot" />
            <div className="story-contact"><div className="contact-copy"><span>Come visit or call us to order:</span><strong>{phone || '+63 917 102 0722'}</strong></div></div>
          </article>
          </div>
        </div>
      </section>

      <aside className="editor-pane" aria-labelledby="editor-title">
        <div className="editor-header">
          <div className="editor-icon"><UtensilsCrossed aria-hidden="true" /></div>
          <div><p className="eyebrow">Menu generator</p><h2 id="editor-title">Build today’s menu</h2></div>
        </div>
        <div className="editor-scroll">
          <section className="settings-section" aria-labelledby="details-heading">
            <div className="section-heading"><h3 id="details-heading">Story details</h3></div>
            <div className="detail-grid">
              <label><span>Today’s date</span><Input value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label><span>Category</span><Input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
              <label className="phone-field"><span>Order phone</span><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="items-heading">
            <div className="section-heading">
              <div><h3 id="items-heading">Menu items</h3><p>{items.length} {items.length === 1 ? 'item' : 'items'}</p></div>
            </div>
            <div className="item-editor-list">
              {items.map((item, index) => (
                <div
                  className={`item-editor${dragOverIndex === index ? ' is-drag-over' : ''}${draggedIndex === index ? ' is-dragging' : ''}`}
                  key={item.id}
                  onDragOver={(event) => { event.preventDefault(); setDragOverIndex(index); }}
                  onDragLeave={() => setDragOverIndex((current) => current === index ? null : current)}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedIndex !== null) moveItem(draggedIndex, index);
                    setDraggedIndex(null); setDragOverIndex(null);
                  }}
                >
                  <button
                    className="drag-handle"
                    draggable
                    aria-label={`Drag to reorder ${item.name}`}
                    onDragStart={(event) => { setDraggedIndex(index); event.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
                  ><GripVertical /></button>
                  <div className="item-fields">
                    <label><span className="sr-only">Item {index + 1} name</span><Input value={item.name} placeholder="Item name" onChange={(event) => updateItem(item.id, 'name', event.target.value)} /></label>
                    <label><span className="sr-only">Item {index + 1} price</span><Input className="price-input" value={item.price} placeholder="Price" onChange={(event) => updateItem(item.id, 'price', event.target.value)} /></label>
                  </div>
                  <div className="item-actions">
                    <Button variant="ghost" size="icon-sm" className="delete-button" aria-label={`Remove ${item.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 /></Button>
                  </div>
                </div>
              ))}
              <button className="add-item-row" onClick={addItem}><span className="add-item-tab"><Plus /></span><span>Add menu item</span></button>
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}
