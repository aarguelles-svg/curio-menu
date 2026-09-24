'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type MenuItem = { id: number; name: string; price: string };

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

export default function Home() {
  const [items, setItems] = useState(initialItems);
  const [date, setDate] = useState('TODAY’S');
  const [category, setCategory] = useState('MAINS');
  const [phone, setPhone] = useState('+63 917 102 0722');
  const nextId = useMemo(() => Math.max(0, ...items.map((item) => item.id)) + 1, [items]);

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

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((current) => {
      const updated = [...current];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      return updated;
    });
  }

  function addItem() {
    setItems((current) => [...current, { id: nextId, name: `Menu Item ${current.length + 1}`, price: 'Pxxx' }]);
  }

  return (
    <main className="app-shell">
      <section className="preview-pane" aria-labelledby="preview-title">
        <div className="preview-heading">
          <div><p className="eyebrow">Live preview</p><h1 id="preview-title">Instagram Story</h1></div>
          <span className="size-label">1080 × 1920</span>
        </div>
        <div className="story-stage">
          <article className="story" aria-label="Generated daily menu preview">
            <div className="menu-card">
              <div className="menu-title"><span>{date || '[DATE]'} MENU</span><strong>{category || 'MAINS'}</strong></div>
              <img className="wave-mascot" src="/assets/wave-mascot.png" alt="Waving mascot" />
              <div className="menu-list" style={{ '--item-count': Math.max(items.length, 1) } as React.CSSProperties}>
                {items.length ? items.map((item) => (
                  <div className="story-menu-row" key={item.id}>
                    <span>{item.name || 'Untitled item'}</span><em>{item.price || '—'}</em>
                  </div>
                )) : <div className="empty-menu">Add your first menu item</div>}
              </div>
            </div>
            <img className="point-mascot" src="/assets/point-mascot.png" alt="Pointing mascot" />
            <div className="story-contact"><span>Come visit or call us to order:</span><strong>{phone || '+63 917 102 0722'}</strong></div>
          </article>
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
              <label><span>Date label</span><Input value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label><span>Category</span><Input value={category} onChange={(event) => setCategory(event.target.value)} /></label>
              <label className="phone-field"><span>Order phone</span><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="items-heading">
            <div className="section-heading">
              <div><h3 id="items-heading">Menu items</h3><p>{items.length} {items.length === 1 ? 'item' : 'items'}</p></div>
              <Button className="add-button" onClick={addItem} size="lg"><Plus aria-hidden="true" /> Add item</Button>
            </div>
            <div className="item-editor-list">
              {items.map((item, index) => (
                <div className="item-editor" key={item.id}>
                  <span className="item-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="item-fields">
                    <label><span className="sr-only">Item {index + 1} name</span><Input value={item.name} placeholder="Item name" onChange={(event) => updateItem(item.id, 'name', event.target.value)} /></label>
                    <label><span className="sr-only">Item {index + 1} price</span><Input className="price-input" value={item.price} placeholder="Price" onChange={(event) => updateItem(item.id, 'price', event.target.value)} /></label>
                  </div>
                  <div className="item-actions" aria-label={`Reorder or remove ${item.name}`}>
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${item.name} down`} disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown /></Button>
                    <Button variant="ghost" size="icon-sm" className="delete-button" aria-label={`Remove ${item.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 /></Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}
