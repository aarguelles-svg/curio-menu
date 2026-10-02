'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  GripVertical,
  LoaderCircle,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MenuItem } from './menu-types';

const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const maxMenuItems = 12;

function menuPrice(item: MenuItem) {
  const first = item.price ? `P${item.price}` : 'P-';
  if (!item.showSecondPrice) return first;
  return `${first}/${item.secondPrice ? `P${item.secondPrice}` : 'P-'}`;
}

const initialItems: MenuItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  name: '',
  price: '',
}));

function formatToday() {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export default function InstagramMenuGenerator({
  items,
  setItems,
}: {
  items: MenuItem[];
  setItems: React.Dispatch<React.SetStateAction<MenuItem[]>>;
}) {
  const [date, setDate] = useState(formatToday);
  const [category, setCategory] = useState('MAINS');
  const [phone, setPhone] = useState('+63 917 102 0722');
  const [previewScale, setPreviewScale] = useState(1);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [menuContentHeight, setMenuContentHeight] = useState(
    initialItems.length * 112,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const menuListRef = useRef<HTMLDivElement>(null);
  const nextId = useMemo(
    () => Math.max(0, ...items.map((item) => item.id)) + 1,
    [items],
  );
  const storyItemCount = Math.max(items.length, 1);
  const menuHeight = 172 + menuContentHeight;
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
    const menuList = menuListRef.current;
    if (!menuList) return;
    const measure = () => setMenuContentHeight(menuList.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menuList);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      modelContext.registerTool(
        {
          name: 'set_daily_menu',
          title: 'Set daily menu',
          description:
            'Replace the visible story details and menu items in one action.',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              category: { type: 'string' },
              phone: { type: 'string' },
              items: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    price: { type: 'string' },
                  },
                  required: ['name', 'price'],
                  additionalProperties: false,
                },
              },
            },
            required: ['date', 'category', 'phone', 'items'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input: unknown) {
            const value = input as {
              date?: unknown;
              category?: unknown;
              phone?: unknown;
              items?: unknown;
            };
            if (
              typeof value.date !== 'string' ||
              typeof value.category !== 'string' ||
              typeof value.phone !== 'string' ||
              !Array.isArray(value.items) ||
              !value.items.length
            )
              throw new Error(
                'Provide date, category, phone, and at least one menu item.',
              );
            const normalized = value.items.map((entry, index) => {
              const item = entry as { name?: unknown; price?: unknown };
              if (
                typeof item.name !== 'string' ||
                typeof item.price !== 'string'
              )
                throw new Error(
                  `Menu item ${index + 1} needs a name and price.`,
                );
              return {
                id: index + 1,
                name: item.name,
                price: item.price.replace(/\D/g, ''),
                secondPrice: '',
                showSecondPrice: false,
              };
            });
            setDate(value.date);
            setCategory(value.category);
            setPhone(value.phone);
            setItems(normalized);
            return { status: 'updated', itemCount: normalized.length };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function updateItem(id: number, patch: Partial<MenuItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function moveItem(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= items.length ||
      to >= items.length
    )
      return;
    setItems((current) => {
      const updated = [...current];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);
      return updated;
    });
  }

  function addItem() {
    setItems((current) =>
      current.length >= maxMenuItems
        ? current
        : [
            ...current,
            {
              id: nextId,
              name: '',
              price: '',
              secondPrice: '',
              showSecondPrice: false,
            },
          ],
    );
  }

  function setItemCount(count: number) {
    setItems((current) => {
      if (count <= current.length) return current.slice(0, count);
      let id = Math.max(0, ...current.map((item) => item.id)) + 1;
      return [
        ...current,
        ...Array.from({ length: count - current.length }, () => ({
          id: id++,
          name: '',
          price: '',
          secondPrice: '',
          showSecondPrice: false,
        })),
      ];
    });
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
          <div>
            <p className="eyebrow">Live preview</p>
            <h1 id="preview-title">Instagram Story</h1>
          </div>
          <div className="preview-actions">
            <span className="size-label">1080 × 1920</span>
            <Button
              className="export-button"
              onClick={exportPng}
              disabled={isExporting}
            >
              {isExporting ? <LoaderCircle className="spin" /> : <Download />}{' '}
              {isExporting ? 'Exporting…' : 'Export PNG'}
            </Button>
          </div>
        </div>
        <div className="story-stage">
          <div className="story-viewport" ref={viewportRef}>
            <article
              ref={storyRef}
              className="story"
              style={
                {
                  transform: `scale(${previewScale})`,
                  '--item-count': storyItemCount,
                  '--menu-height': `${menuHeight}px`,
                  '--card-top': `${cardTop}px`,
                  backgroundImage: `url('${publicBase}/assets/noise-bg.png')`,
                } as React.CSSProperties
              }
              aria-label="Generated daily menu preview"
            >
              <div className="menu-card">
                <div className="menu-title">
                  <span>{date || '[DATE]'} MENU</span>
                  <strong>{category || 'MAINS'}</strong>
                </div>
                <img
                  className="wave-mascot"
                  src={`${publicBase}/assets/wave-mascot.png`}
                  alt="Waving mascot"
                />
                <div className="menu-list" ref={menuListRef}>
                  {items.length ? (
                    items.map((item, index) => (
                      <div className="story-menu-row" key={item.id}>
                        <span
                          className={item.name ? undefined : 'is-placeholder'}
                        >
                          {item.name || `Menu item ${index + 1}`}
                        </span>
                        <em
                          className={item.price ? undefined : 'is-placeholder'}
                        >
                          {menuPrice(item)}
                        </em>
                      </div>
                    ))
                  ) : (
                    <div className="empty-menu">Add your first menu item</div>
                  )}
                </div>
              </div>
              <img
                className="point-mascot"
                src={`${publicBase}/assets/point-mascot.png`}
                alt="Pointing mascot"
              />
              <div className="story-contact">
                <div className="contact-copy">
                  <span>Come visit or call us to order:</span>
                  <strong>{phone || '+63 917 102 0722'}</strong>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <aside className="editor-pane" aria-labelledby="editor-title">
        <div className="editor-header">
          <div className="editor-icon">
            <UtensilsCrossed aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Menu generator</p>
            <h2 id="editor-title">Build today’s menu</h2>
          </div>
        </div>
        <div className="editor-scroll">
          <section
            className="settings-section"
            aria-labelledby="details-heading"
          >
            <div className="section-heading">
              <h3 id="details-heading">Story details</h3>
            </div>
            <div className="detail-grid">
              <label>
                <span>Today’s date</span>
                <Input
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label>
                <span>Category</span>
                <Input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <label className="phone-field">
                <span>Order phone</span>
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="items-heading">
            <div className="section-heading">
              <div>
                <h3 id="items-heading">Menu items</h3>
                <select
                  className="item-count-select"
                  aria-label="Number of menu items"
                  value={items.length}
                  onChange={(event) => setItemCount(Number(event.target.value))}
                >
                  {Array.from(
                    { length: maxMenuItems },
                    (_, index) => index + 1,
                  ).map((count) => (
                    <option value={count} key={count}>
                      {count} {count === 1 ? 'item' : 'items'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="item-editor-list">
              {items.map((item, index) => (
                <div
                  className={`item-editor${dragOverIndex === index ? ' is-drag-over' : ''}${draggedIndex === index ? ' is-dragging' : ''}`}
                  key={item.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverIndex(index);
                  }}
                  onDragLeave={() =>
                    setDragOverIndex((current) =>
                      current === index ? null : current,
                    )
                  }
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedIndex !== null) moveItem(draggedIndex, index);
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                >
                  <button
                    className="drag-handle"
                    draggable
                    aria-label={`Drag to reorder ${item.name}`}
                    onDragStart={(event) => {
                      setDraggedIndex(index);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    <GripVertical />
                  </button>
                  <div className="item-fields">
                    <label>
                      <span className="sr-only">Item {index + 1} name</span>
                      <Input
                        value={item.name}
                        placeholder="Item name"
                        onChange={(event) =>
                          updateItem(item.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <div className="price-stack-editor">
                      <div className="price-field price-field-with-action">
                        <span className="price-prefix" aria-hidden="true">
                          P
                        </span>
                        <Input
                          className="price-input"
                          value={item.price}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="0"
                          aria-label={`Item ${index + 1} price`}
                          onChange={(event) =>
                            updateItem(item.id, {
                              price: event.target.value.replace(/\D/g, ''),
                            })
                          }
                        />
                        {!item.showSecondPrice && (
                          <button
                            type="button"
                            className="field-hover-action"
                            title="Add second price"
                            aria-label={`Add a second price to ${item.name || `item ${index + 1}`}`}
                            onClick={() =>
                              updateItem(item.id, { showSecondPrice: true })
                            }
                          >
                            <Plus />
                          </button>
                        )}
                      </div>
                      {item.showSecondPrice && (
                        <div className="price-field price-field-with-action">
                          <span className="price-prefix" aria-hidden="true">
                            P
                          </span>
                          <Input
                            className="price-input"
                            value={item.secondPrice ?? ''}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="0"
                            aria-label={`Item ${index + 1} second price`}
                            onChange={(event) =>
                              updateItem(item.id, {
                                secondPrice: event.target.value.replace(
                                  /\D/g,
                                  '',
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="field-hover-action is-visible"
                            title="Remove second price"
                            aria-label={`Remove the second price from ${item.name || `item ${index + 1}`}`}
                            onClick={() =>
                              updateItem(item.id, {
                                showSecondPrice: false,
                                secondPrice: '',
                              })
                            }
                          >
                            <X />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="item-actions">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="delete-button"
                      aria-label={`Remove ${item.name || `item ${index + 1}`}`}
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((current) =>
                          current.filter((entry) => entry.id !== item.id),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
              <button
                className="add-item-row"
                onClick={addItem}
                disabled={items.length >= maxMenuItems}
              >
                <span className="add-item-tab">
                  <Plus />
                </span>
                <span>
                  {items.length >= maxMenuItems
                    ? 'Maximum 12 items'
                    : 'Add menu item'}
                </span>
              </button>
            </div>
          </section>
        </div>
      </aside>
    </main>
  );
}
