'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Captions,
  Download,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Plus,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import { toCanvas } from 'html-to-image';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase, tvMediaBucket } from '@/lib/supabase';
import type { DrinkItem, DrinkSection, MenuItem, TvLayout } from './menu-types';

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
type DisplayEntry =
  | { kind: 'heat-eat'; duration: number }
  | { kind: 'media'; slide: MediaSlide };

const publicBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const menuCountMax = 12;
const tvExportFps = 2;
const tvExportFrameDelay = 1000 / tvExportFps;
const gifPaletteSize = 256;
const fixedArtworkPaletteSize = 128;
const mediaPaletteSize = gifPaletteSize - fixedArtworkPaletteSize;

function menuPrice(
  item: MenuItem,
  placeholder = 'P-',
  hideMissing = false,
) {
  const first = item.price ? `P${item.price}` : hideMissing ? '' : placeholder;
  if (!item.showSecondPrice) return first;
  const second = item.secondPrice
    ? `P${item.secondPrice}`
    : hideMissing
      ? ''
      : placeholder;
  return hideMissing
    ? [first, second].filter(Boolean).join('/')
    : `${first}/${second}`;
}

function hasMenuItemContent(item: MenuItem) {
  return Boolean(
    item.name.trim() ||
      item.price.trim() ||
      (item.showSecondPrice && item.secondPrice.trim()),
  );
}

function hasDrinkItemContent(item: DrinkItem) {
  return Boolean(
    item.name.trim() ||
      (item.showSubtitle && item.subtitle.trim()) ||
      item.price.trim() ||
      item.coldPrice.trim(),
  );
}

function safeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function waitFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Could not load an uploaded image for export.'));
    image.src = url;
  });
}

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const x = 1336,
    y = 127,
    width = 481,
    height = 614,
    radius = 30;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.clip();
  context.drawImage(
    source,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

function drawWaveMascot(
  context: CanvasRenderingContext2D,
  mascot: CanvasImageSource,
) {
  const width = 180,
    height = 180,
    x = 1920 + 10 - width,
    y = 12;
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate((13 * Math.PI) / 180);
  context.scale(-1, 1);
  context.drawImage(mascot, -width / 2, -height / 2, width, height);
  context.restore();
}

function mergePalettes(
  primary: number[][],
  secondary: number[][],
  limit: number,
) {
  const palette: number[][] = [];
  const colors = new Set<string>();
  for (const color of [...primary, ...secondary]) {
    const key = `${color[0]},${color[1]},${color[2]}`;
    if (colors.has(key)) continue;
    colors.add(key);
    palette.push(color);
    if (palette.length === limit) break;
  }
  return palette;
}

function ItemEditor({
  title,
  items,
  setItems,
}: {
  title: string;
  items: MenuItem[];
  setItems: React.Dispatch<React.SetStateAction<MenuItem[]>>;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const nextId = useMemo(
    () => Math.max(0, ...items.map((item) => item.id)) + 1,
    [items],
  );
  const update = (id: number, patch: Partial<MenuItem>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const setCount = (count: number) =>
    setItems((current) =>
      count <= current.length
        ? current.slice(0, count)
        : [
            ...current,
            ...Array.from({ length: count - current.length }, (_, index) => ({
              id: Math.max(0, ...current.map((item) => item.id)) + index + 1,
              name: '',
              price: '',
              secondPrice: '',
              showSecondPrice: false,
            })),
          ],
    );

  return (
    <section className="settings-section tv-menu-editor">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <select
            className="item-count-select"
            value={items.length}
            onChange={(event) => setCount(Number(event.target.value))}
            aria-label={`${title} item count`}
          >
            {Array.from({ length: menuCountMax }, (_, index) => index + 1).map(
              (count) => (
                <option key={count} value={count}>
                  {count} {count === 1 ? 'item' : 'items'}
                </option>
              ),
            )}
          </select>
        </div>
      </div>
      <div className="item-editor-list">
        {items.map((item, index) => (
          <div
            className={`item-editor${dragged === index ? ' is-dragging' : ''}`}
            key={item.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged === null || dragged === index)
                return setDragged(null);
              setItems((current) => {
                const copy = [...current];
                const [moved] = copy.splice(dragged, 1);
                copy.splice(index, 0, moved);
                return copy;
              });
              setDragged(null);
            }}
          >
            <button
              className="drag-handle"
              draggable
              aria-label={`Drag ${title} item ${index + 1}`}
              onDragStart={() => setDragged(index)}
              onDragEnd={() => setDragged(null)}
            >
              <GripVertical />
            </button>
            <div className="item-fields">
              <Input
                value={item.name}
                placeholder="Item name"
                onChange={(event) =>
                  update(item.id, { name: event.target.value })
                }
              />
              <div className="price-stack-editor">
                <div className="price-field price-field-with-action">
                  <span className="price-prefix">P</span>
                  <Input
                    className="price-input"
                    inputMode="numeric"
                    value={item.price}
                    placeholder="0"
                    aria-label={`${title} item ${index + 1} price`}
                    onChange={(event) =>
                      update(item.id, {
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
                      onClick={() => update(item.id, { showSecondPrice: true })}
                    >
                      <Plus />
                    </button>
                  )}
                </div>
                {item.showSecondPrice && (
                  <div className="price-field price-field-with-action">
                    <span className="price-prefix">P</span>
                    <Input
                      className="price-input"
                      inputMode="numeric"
                      value={item.secondPrice ?? ''}
                      placeholder="0"
                      aria-label={`${title} item ${index + 1} second price`}
                      onChange={(event) =>
                        update(item.id, {
                          secondPrice: event.target.value.replace(/\D/g, ''),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="field-hover-action is-visible"
                      title="Remove second price"
                      aria-label={`Remove the second price from ${item.name || `item ${index + 1}`}`}
                      onClick={() =>
                        update(item.id, {
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
          disabled={items.length >= menuCountMax}
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                id: nextId,
                name: '',
                price: '',
                secondPrice: '',
                showSecondPrice: false,
              },
            ])
          }
        >
          <span className="add-item-tab">
            <Plus />
          </span>
          <span>
            {items.length >= menuCountMax
              ? 'Maximum 12 items'
              : `Add to ${title}`}
          </span>
        </button>
      </div>
    </section>
  );
}

function DrinkEditor({
  section,
  title,
  items,
  setItems,
}: {
  section: DrinkSection;
  title: string;
  items: DrinkItem[];
  setItems: React.Dispatch<React.SetStateAction<DrinkItem[]>>;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const sectionItems = items.filter((item) => item.section === section);
  const nextId = Math.max(0, ...items.map((item) => item.id)) + 1;
  const update = (id: number, patch: Partial<DrinkItem>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const reorder = (from: number, to: number) =>
    setItems((current) => {
      const matching = current.filter((item) => item.section === section);
      const [moved] = matching.splice(from, 1);
      matching.splice(to, 0, moved);
      let matchingIndex = 0;
      return current.map((item) =>
        item.section === section ? matching[matchingIndex++] : item,
      );
    });

  return (
    <section className="settings-section tv-menu-editor drink-editor-section">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <p>
            {section === 'coffee'
              ? 'Hot and cold prices'
              : 'One or two prices per drink'}
          </p>
        </div>
      </div>
      <div className="item-editor-list">
        {sectionItems.map((item, index) => (
          <div
            className={`item-editor drink-editor${dragged === index ? ' is-dragging' : ''}`}
            key={item.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged !== null && dragged !== index)
                reorder(dragged, index);
              setDragged(null);
            }}
          >
            <button
              className="drag-handle"
              draggable
              aria-label={`Drag ${title} item ${index + 1}`}
              onDragStart={() => setDragged(index)}
              onDragEnd={() => setDragged(null)}
            >
              <GripVertical />
            </button>
            <div className="item-fields drink-fields">
              <div className="drink-name-column">
                <div className="name-field-with-action">
                  <Input
                    value={item.name}
                    placeholder="Drink name"
                    onChange={(event) =>
                      update(item.id, { name: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className={`field-hover-action${item.showSubtitle ? ' is-visible' : ''}`}
                    title={
                      item.showSubtitle ? 'Remove subtitle' : 'Add subtitle'
                    }
                    aria-label={
                      item.showSubtitle ? 'Remove subtitle' : 'Add subtitle'
                    }
                    onClick={() =>
                      update(item.id, { showSubtitle: !item.showSubtitle })
                    }
                  >
                    {item.showSubtitle ? <X /> : <Captions />}
                  </button>
                </div>
                {item.showSubtitle && (
                  <Input
                    className="drink-subtitle-input"
                    value={item.subtitle}
                    placeholder="Subtitle, sizes, or flavors"
                    onChange={(event) =>
                      update(item.id, { subtitle: event.target.value })
                    }
                  />
                )}
              </div>
              <div className="drink-price-fields">
                <div className="price-field price-field-with-action">
                  <span className="price-prefix">P</span>
                  <Input
                    className="price-input"
                    inputMode="numeric"
                    value={item.price}
                    placeholder={section === 'coffee' ? 'Hot' : '0'}
                    onChange={(event) =>
                      update(item.id, {
                        price: event.target.value.replace(/\D/g, ''),
                      })
                    }
                  />
                  {section === 'cold' && !item.showSecondPrice && (
                    <button
                      type="button"
                      className="field-hover-action"
                      title="Add second price"
                      aria-label={`Add a second price to ${item.name || `cold drink ${index + 1}`}`}
                      onClick={() => update(item.id, { showSecondPrice: true })}
                    >
                      <Plus />
                    </button>
                  )}
                </div>
                {(section === 'coffee' || item.showSecondPrice) && (
                  <div className="price-field price-field-with-action">
                    <span className="price-prefix">P</span>
                    <Input
                      className="price-input"
                      inputMode="numeric"
                      value={item.coldPrice}
                      placeholder="Cold"
                      onChange={(event) =>
                        update(item.id, {
                          coldPrice: event.target.value.replace(/\D/g, ''),
                        })
                      }
                    />
                    {section === 'cold' && (
                      <button
                        type="button"
                        className="field-hover-action is-visible"
                        title="Remove second price"
                        aria-label={`Remove the second price from ${item.name || `cold drink ${index + 1}`}`}
                        onClick={() =>
                          update(item.id, {
                            showSecondPrice: false,
                            coldPrice: '',
                          })
                        }
                      >
                        <X />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="item-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                className="delete-button"
                disabled={sectionItems.length === 1}
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
          disabled={sectionItems.length >= 6}
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                id: nextId,
                section,
                name: '',
                subtitle: '',
                showSubtitle: false,
                price: '',
                coldPrice: '',
                showSecondPrice: false,
              },
            ])
          }
        >
          <span className="add-item-tab">
            <Plus />
          </span>
          <span>
            {sectionItems.length >= 6 ? 'Maximum 6 items' : `Add to ${title}`}
          </span>
        </button>
      </div>
    </section>
  );
}

function HeatEatSlide({
  items,
  title,
  hidePlaceholders = false,
  editable,
  editing,
  draft,
  onEdit,
  onDraft,
  onSave,
}: {
  items: MenuItem[];
  title: string;
  hidePlaceholders?: boolean;
  editable?: boolean;
  editing?: boolean;
  draft?: string;
  onEdit?: () => void;
  onDraft?: (value: string) => void;
  onSave?: () => void;
}) {
  return (
    <div className="tv-heat-slide">
      <div
        className={`tv-heat-slide-title${editable ? ' is-editable' : ''}`}
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        title={editable ? 'Double-click to edit' : undefined}
        onDoubleClick={onEdit}
        onKeyDown={(event) => {
          if (editable && event.key === 'Enter') onEdit?.();
        }}
      >
        {editing ? (
          <input
            className="tv-card-title-input"
            autoFocus
            maxLength={24}
            value={draft}
            aria-label="Edit Heat and Eat header"
            onChange={(event) => onDraft?.(event.target.value)}
            onBlur={onSave}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        ) : (
          title
        )}
      </div>
      <div className="tv-heat-slide-list">
        {items
          .filter((item) => !hidePlaceholders || hasMenuItemContent(item))
          .map((item, index) => (
          <div className="tv-heat-slide-row" key={item.id}>
            <strong className={item.name ? '' : 'is-placeholder'}>
              {item.name || (hidePlaceholders ? '' : `Menu item ${index + 1}`)}
            </strong>
            <span className={item.price ? '' : 'is-placeholder'}>
              {menuPrice(item, 'P-', hidePlaceholders)}
            </span>
          </div>
          ))}
      </div>
    </div>
  );
}

function DrinksCard({
  items,
  hidePlaceholders = false,
}: {
  items: DrinkItem[];
  hidePlaceholders?: boolean;
}) {
  const coffee = items.filter(
    (item) =>
      item.section === 'coffee' &&
      (!hidePlaceholders || hasDrinkItemContent(item)),
  );
  const cold = items.filter(
    (item) =>
      item.section === 'cold' &&
      (!hidePlaceholders || hasDrinkItemContent(item)),
  );
  return (
    <div className="tv-menu-card tv-drinks-card">
      <div className="tv-card-title">COFFEE</div>
      <div className="tv-drinks-heading">
        <span />
        <b>HOT</b>
        <b>COLD</b>
      </div>
      <div className="tv-drink-list tv-coffee-list">
        {coffee.map((item, index) => (
          <div className="tv-drink-row tv-coffee-row" key={item.id}>
            <div>
              <strong className={item.name ? '' : 'is-placeholder'}>
                {item.name || (hidePlaceholders ? '' : `Coffee ${index + 1}`)}
              </strong>
              {item.showSubtitle && (
                <small className={item.subtitle ? '' : 'is-placeholder'}>
                  {item.subtitle || (hidePlaceholders ? '' : 'Subtitle')}
                </small>
              )}
            </div>
            <span className={item.price ? '' : 'is-placeholder'}>
              {item.price ? `P${item.price}` : hidePlaceholders ? '' : 'P-'}
            </span>
            <span className={item.coldPrice ? '' : 'is-placeholder'}>
              {item.coldPrice
                ? `P${item.coldPrice}`
                : hidePlaceholders
                  ? ''
                  : 'P-'}
            </span>
          </div>
        ))}
      </div>
      <div className="tv-cold-title">COLD DRINKS</div>
      <div className="tv-drink-list tv-cold-list">
        {cold.map((item, index) => (
          <div className="tv-drink-row tv-cold-row" key={item.id}>
            <div>
              <strong className={item.name ? '' : 'is-placeholder'}>
                {item.name ||
                  (hidePlaceholders ? '' : `Cold drink ${index + 1}`)}
              </strong>
              {item.showSubtitle && (
                <small className={item.subtitle ? '' : 'is-placeholder'}>
                  {item.subtitle || (hidePlaceholders ? '' : 'Subtitle')}
                </small>
              )}
            </div>
            <span className={item.price ? '' : 'is-placeholder'}>
              {item.showSecondPrice
                ? hidePlaceholders
                  ? [
                      item.price ? `P${item.price}` : '',
                      item.coldPrice ? `P${item.coldPrice}` : '',
                    ]
                      .filter(Boolean)
                      .join('/')
                  : `${item.price ? `P${item.price}` : 'P-'}/${item.coldPrice ? `P${item.coldPrice}` : 'P-'}`
                : item.price
                  ? `P${item.price}`
                  : hidePlaceholders
                    ? ''
                    : 'P-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TvMenuGenerator({
  session,
  mains,
  setMains,
  heatEat,
  setHeatEat,
  drinks,
  setDrinks,
  tvLayout,
  setTvLayout,
  heatEatDuration,
  setHeatEatDuration,
}: {
  session: Session | null;
  mains: MenuItem[];
  setMains: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  heatEat: MenuItem[];
  setHeatEat: React.Dispatch<React.SetStateAction<MenuItem[]>>;
  drinks: DrinkItem[];
  setDrinks: React.Dispatch<React.SetStateAction<DrinkItem[]>>;
  tvLayout: TvLayout;
  setTvLayout: React.Dispatch<React.SetStateAction<TvLayout>>;
  heatEatDuration: number;
  setHeatEatDuration: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [slides, setSlides] = useState<MediaSlide[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [mainsTitle, setMainsTitle] = useState('MAINS');
  const [heatEatTitle, setHeatEatTitle] = useState('HEAT & EAT');
  const [editingTitle, setEditingTitle] = useState<'mains' | 'heat-eat' | null>(
    null,
  );
  const [titleDraft, setTitleDraft] = useState('');
  const [previewScale, setPreviewScale] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [exportTemplate, setExportTemplate] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tvRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLInputElement>(null);
  const heatExportRef = useRef<HTMLDivElement>(null);

  const displayEntries = useMemo<DisplayEntry[]>(
    () => [
      ...(tvLayout === 'drinks'
        ? [{ kind: 'heat-eat' as const, duration: heatEatDuration }]
        : []),
      ...slides.map((slide) => ({ kind: 'media' as const, slide })),
    ],
    [tvLayout, heatEatDuration, slides],
  );
  const currentEntry = displayEntries.length
    ? displayEntries[activeSlide % displayEntries.length]
    : null;

  const publicUrl = useCallback(
    (path: string) =>
      supabase.storage.from(tvMediaBucket).getPublicUrl(path).data.publicUrl,
    [],
  );
  const loadLibrary = useCallback(async () => {
    const [
      { data: media, error: mediaError },
      { data: settings, error: settingsError },
    ] = await Promise.all([
      supabase
        .from('tv_media')
        .select('*')
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('tv_settings')
        .select('qr_path, mains_title, heat_eat_title')
        .eq('id', 1)
        .maybeSingle(),
    ]);
    if (mediaError || settingsError) {
      setSetupNeeded(true);
      setMessage(
        'Supabase needs the included one-time setup script before shared uploads can be used.',
      );
      return;
    }
    setSetupNeeded(false);
    setSlides(
      (media ?? []).map((row) => ({
        ...(row as MediaRow),
        url: publicUrl((row as MediaRow).storage_path),
      })),
    );
    const savedSettings = settings as TvSettings | null;
    const path = savedSettings?.qr_path ?? null;
    setQrPath(path);
    setQrUrl(path ? publicUrl(path) : null);
    setMainsTitle(savedSettings?.mains_title?.trim() || 'MAINS');
    setHeatEatTitle(savedSettings?.heat_eat_title?.trim() || 'HEAT & EAT');
  }, [publicUrl]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      setPreviewScale(Math.min(width / 1920, height / 1080));
    };
    const initialResize = requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(initialResize);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    if (displayEntries.length < 2 || busy === 'export') return;
    const entry = displayEntries[activeSlide % displayEntries.length];
    const duration =
      entry.kind === 'heat-eat' ? entry.duration : entry.slide.duration_seconds;
    const timeout = window.setTimeout(
      () => setActiveSlide((current) => (current + 1) % displayEntries.length),
      Math.max(1, duration) * 1000,
    );
    return () => window.clearTimeout(timeout);
  }, [activeSlide, displayEntries, busy]);

  async function uploadMedia(file: File) {
    if (!session) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        file.type,
      )
    )
      return setMessage('Use a PNG, JPG, WebP, or GIF file.');
    if (file.size > 25 * 1024 * 1024)
      return setMessage('Media must be 25 MB or smaller.');
    setBusy('upload');
    setMessage('Uploading media…');
    const path = `slides/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(tvMediaBucket)
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setBusy(null);
      return setMessage(uploadError.message);
    }
    const { error } = await supabase.from('tv_media').insert({
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      duration_seconds: 10,
      sort_order: slides.length,
      created_by: session.user.id,
    });
    if (error) await supabase.storage.from(tvMediaBucket).remove([path]);
    setBusy(null);
    setMessage(error ? error.message : 'Media added to the shared library.');
    await loadLibrary();
  }

  async function uploadQr(file: File) {
    if (!session) return;
    if (!file.type.startsWith('image/'))
      return setMessage('Please upload an image for the QR code.');
    setBusy('qr');
    const path = `qr/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(tvMediaBucket)
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setBusy(null);
      return setMessage(uploadError.message);
    }
    const { error } = await supabase
      .from('tv_settings')
      .update({ qr_path: path, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (!error && qrPath)
      await supabase.storage.from(tvMediaBucket).remove([qrPath]);
    setBusy(null);
    setMessage(error ? error.message : 'QR code updated for every device.');
    await loadLibrary();
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
    if (section === 'mains') setMainsTitle(nextTitle);
    else setHeatEatTitle(nextTitle);
    setEditingTitle(null);
    if (nextTitle === previousTitle) return;
    setMessage('Saving shared TV header…');
    const { error } = await supabase
      .from('tv_settings')
      .update({ [column]: nextTitle, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) {
      if (section === 'mains') setMainsTitle(previousTitle);
      else setHeatEatTitle(previousTitle);
      setMessage(error.message);
      return;
    }
    setMessage('TV header saved for every device.');
  }

  async function updateSlide(
    id: string,
    patch: Partial<Pick<MediaRow, 'duration_seconds' | 'sort_order'>>,
  ) {
    setSlides((current) =>
      current.map((slide) =>
        slide.id === id ? { ...slide, ...patch } : slide,
      ),
    );
    const { error } = await supabase
      .from('tv_media')
      .update(patch)
      .eq('id', id);
    if (error) {
      setMessage(error.message);
      await loadLibrary();
    }
  }

  async function moveSlide(from: number, to: number) {
    if (from === to || to < 0 || to >= slides.length) return;
    const reordered = [...slides];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setSlides(
      reordered.map((slide, index) => ({ ...slide, sort_order: index })),
    );
    const results = await Promise.all(
      reordered.map((slide, index) =>
        supabase
          .from('tv_media')
          .update({ sort_order: index })
          .eq('id', slide.id),
      ),
    );
    if (results.some(({ error }) => error)) {
      setMessage('Could not save the new order.');
      await loadLibrary();
    }
  }

  async function removeSlide(slide: MediaSlide) {
    setBusy(slide.id);
    const { error } = await supabase
      .from('tv_media')
      .delete()
      .eq('id', slide.id);
    if (!error)
      await supabase.storage.from(tvMediaBucket).remove([slide.storage_path]);
    setBusy(null);
    setMessage(error ? error.message : 'Slide removed.');
    await loadLibrary();
  }

  async function exportGif() {
    if (!tvRef.current || busy) return;
    setBusy('export');
    setMessage('Preparing the fixed menu artwork…');
    setExportTemplate(true);
    try {
      await document.fonts.ready;
      await waitFrame();
      const base = await toCanvas(tvRef.current, {
        width: 1920,
        height: 1080,
        pixelRatio: 1,
        cacheBust: true,
        style: { transform: 'none' },
      });
      const heatArtwork =
        tvLayout === 'drinks' && heatExportRef.current
          ? await toCanvas(heatExportRef.current, {
              width: 535,
              height: 696,
              pixelRatio: 1,
              cacheBust: true,
            })
          : null;
      const waveMascot = await loadImage(
        `${publicBase}/assets/wave-mascot.png`,
      );
      const encoder = GIFEncoder();
      let frameCount = 0;
      const baseContext = base.getContext('2d')!;
      const basePixels = baseContext.getImageData(0, 0, 1920, 1080).data;
      const fixedArtworkPalette = quantize(
        basePixels,
        fixedArtworkPaletteSize,
        {
          format: 'rgb444',
          useSqrt: false,
        },
      );
      const mediaSampleBuffers: Uint8ClampedArray[] = [];
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 320;
      sampleCanvas.height = 180;
      const sampleContext = sampleCanvas.getContext('2d')!;
      for (const entry of displayEntries) {
        if (entry.kind !== 'media') continue;
        const image = await loadImage(entry.slide.url);
        sampleContext.clearRect(0, 0, 320, 180);
        sampleContext.drawImage(image, 0, 0, 320, 180);
        mediaSampleBuffers.push(
          sampleContext.getImageData(0, 0, 320, 180).data,
        );
      }
      const mediaSampleLength = mediaSampleBuffers.reduce(
        (total, pixels) => total + pixels.length,
        0,
      );
      const mediaSamples = new Uint8Array(mediaSampleLength);
      let mediaSampleOffset = 0;
      for (const pixels of mediaSampleBuffers) {
        mediaSamples.set(pixels, mediaSampleOffset);
        mediaSampleOffset += pixels.length;
      }
      const mediaPalette = mediaSamples.length
        ? quantize(mediaSamples, mediaPaletteSize, {
            format: 'rgb444',
            useSqrt: false,
          })
        : [];
      const stablePalette = mergePalettes(
        fixedArtworkPalette,
        mediaPalette,
        gifPaletteSize,
      );
      const prepareFrame = (canvas: HTMLCanvasElement) => {
        const data = canvas
          .getContext('2d')!
          .getImageData(0, 0, 1920, 1080).data;
        return {
          indexed: applyPalette(data, stablePalette, 'rgb444'),
          palette: stablePalette,
        };
      };
      const writePreparedFrame = (
        { indexed, palette }: ReturnType<typeof prepareFrame>,
        repeats = 1,
      ) => {
        for (let index = 0; index < repeats; index += 1) {
          encoder.writeFrame(indexed, 1920, 1080, {
            palette,
            delay: tvExportFrameDelay,
            repeat: 0,
          });
          frameCount += 1;
          if (frameCount === 1 || frameCount % tvExportFps === 0)
            setMessage(`Encoding TV frame ${frameCount}…`);
        }
      };
      const encode = (canvas: HTMLCanvasElement, repeats = 1) =>
        writePreparedFrame(prepareFrame(canvas), repeats);
      const output = document.createElement('canvas');
      output.width = 1920;
      output.height = 1080;
      const context = output.getContext('2d')!;
      const drawBase = () => {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, output.width, output.height);
        context.drawImage(base, 0, 0);
      };
      const list: Array<DisplayEntry | null> = displayEntries.length
        ? displayEntries
        : [null];
      for (const entry of list) {
        if (!entry) {
          drawBase();
          drawWaveMascot(context, waveMascot);
          encode(output, tvExportFps);
          continue;
        }
        if (entry.kind === 'heat-eat') {
          drawBase();
          if (heatArtwork) context.drawImage(heatArtwork, 1309, 72, 535, 696);
          drawWaveMascot(context, waveMascot);
          encode(
            output,
            Math.max(tvExportFps, Math.round(entry.duration * tvExportFps)),
          );
          continue;
        }
        const slide = entry.slide;
        const targetFrames = Math.max(
          tvExportFps,
          Math.round(slide.duration_seconds * tvExportFps),
        );
        if (slide.mime_type === 'image/gif') {
          const buffer = await fetch(slide.url).then((response) =>
            response.arrayBuffer(),
          );
          const parsed = parseGIF(buffer);
          const decoded = decompressFrames(parsed, true);
          const source = document.createElement('canvas');
          source.width = parsed.lsd.width;
          source.height = parsed.lsd.height;
          const sourceContext = source.getContext('2d')!;
          const patchCanvas = document.createElement('canvas');
          const patchContext = patchCanvas.getContext('2d')!;
          const frameEnds: number[] = [];
          let loopDuration = 0;
          for (const frame of decoded) {
            loopDuration += Math.max(20, frame.delay || 100);
            frameEnds.push(loopDuration);
          }
          const sourceIndices = Array.from(
            { length: targetFrames },
            (_, index) => {
              const loopTime =
                (index * tvExportFrameDelay) %
                Math.max(tvExportFrameDelay, loopDuration);
              const match = frameEnds.findIndex((end) => loopTime < end);
              return match < 0 ? decoded.length - 1 : match;
            },
          );
          const neededIndices = new Set(sourceIndices);
          const preparedFrames = new Map<
            number,
            ReturnType<typeof prepareFrame>
          >();
          let previousFrame: (typeof decoded)[number] | null = null;
          let restoreSnapshot: ImageData | null = null;
          for (
            let decodedIndex = 0;
            decodedIndex < decoded.length &&
            preparedFrames.size < neededIndices.size;
            decodedIndex += 1
          ) {
            const frame = decoded[decodedIndex];
            if (previousFrame?.disposalType === 2)
              sourceContext.clearRect(
                previousFrame.dims.left,
                previousFrame.dims.top,
                previousFrame.dims.width,
                previousFrame.dims.height,
              );
            if (previousFrame?.disposalType === 3 && restoreSnapshot)
              sourceContext.putImageData(restoreSnapshot, 0, 0);
            restoreSnapshot =
              frame.disposalType === 3
                ? sourceContext.getImageData(0, 0, source.width, source.height)
                : null;
            const patchBytes = new Uint8ClampedArray(frame.patch.length);
            patchBytes.set(frame.patch);
            const patch = new ImageData(
              patchBytes,
              frame.dims.width,
              frame.dims.height,
            );
            patchCanvas.width = frame.dims.width;
            patchCanvas.height = frame.dims.height;
            patchContext.putImageData(patch, 0, 0);
            sourceContext.drawImage(
              patchCanvas,
              frame.dims.left,
              frame.dims.top,
            );
            previousFrame = frame;
            if (neededIndices.has(decodedIndex)) {
              drawBase();
              drawCover(context, source, source.width, source.height);
              drawWaveMascot(context, waveMascot);
              preparedFrames.set(decodedIndex, prepareFrame(output));
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
          for (const sourceIndex of sourceIndices)
            writePreparedFrame(preparedFrames.get(sourceIndex)!);
        } else {
          const image = await loadImage(slide.url);
          drawBase();
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
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'curio-tv-menu.gif';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `Exported ${frameCount} TV-compatible GIF frames at ${tvExportFps} fps.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GIF export failed.');
    } finally {
      setExportTemplate(false);
      setBusy(null);
    }
  }

  return (
    <main className="app-shell tv-app-shell">
      <section className="preview-pane" aria-labelledby="tv-preview-title">
        <div className="preview-heading">
          <div>
            <p className="eyebrow">Live preview</p>
            <h1 id="tv-preview-title">TV Menu</h1>
          </div>
          <div className="preview-actions">
            <span className="size-label">1920 × 1080</span>
            <Button
              className="export-button"
              onClick={exportGif}
              disabled={Boolean(busy)}
            >
              {busy === 'export' ? (
                <LoaderCircle className="spin" />
              ) : (
                <Download />
              )}
              {busy === 'export' ? 'Exporting…' : 'Export GIF'}
            </Button>
          </div>
        </div>
        <div className="tv-stage">
          <div className="tv-viewport" ref={viewportRef}>
            <article
              ref={tvRef}
              className={`tv-canvas${exportTemplate ? ' is-export-template' : ''}`}
              style={{
                transform: `scale(${previewScale ?? 0})`,
                visibility: previewScale === null ? 'hidden' : 'visible',
                backgroundImage: `url('${publicBase}/assets/noise-bg-tv.png')`,
              }}
            >
              <div className="tv-menu-card tv-main-card">
                <div
                  className="tv-card-title is-editable"
                  role="button"
                  tabIndex={0}
                  title="Double-click to edit"
                  aria-label="Mains header. Double-click to edit."
                  onDoubleClick={() => beginTitleEdit('mains')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') beginTitleEdit('mains');
                  }}
                >
                  {editingTitle === 'mains' ? (
                    <input
                      className="tv-card-title-input"
                      autoFocus
                      maxLength={24}
                      value={titleDraft}
                      aria-label="Edit Mains header"
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => void saveTitle('mains')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                  ) : (
                    mainsTitle
                  )}
                </div>
                <div className="tv-menu-list">
                  {mains
                    .filter(
                      (item) =>
                        !exportTemplate || hasMenuItemContent(item),
                    )
                    .map((item, index) => (
                      <div className="tv-menu-row" key={item.id}>
                        <strong className={item.name ? '' : 'is-placeholder'}>
                          {item.name ||
                            (exportTemplate ? '' : `Menu item ${index + 1}`)}
                        </strong>
                        <span className={item.price ? '' : 'is-placeholder'}>
                          {menuPrice(item, 'P-', exportTemplate)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
              {tvLayout === 'no-drinks' ? (
                <div className="tv-menu-card tv-heat-card">
                  <div
                    className="tv-card-title is-editable"
                    role="button"
                    tabIndex={0}
                    title="Double-click to edit"
                    aria-label="Heat and Eat header. Double-click to edit."
                    onDoubleClick={() => beginTitleEdit('heat-eat')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') beginTitleEdit('heat-eat');
                    }}
                  >
                    {editingTitle === 'heat-eat' ? (
                      <input
                        className="tv-card-title-input"
                        autoFocus
                        maxLength={24}
                        value={titleDraft}
                        aria-label="Edit Heat and Eat header"
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={() => void saveTitle('heat-eat')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    ) : (
                      heatEatTitle
                    )}
                  </div>
                  <div className="tv-menu-list">
                    {heatEat
                      .filter(
                        (item) =>
                          !exportTemplate || hasMenuItemContent(item),
                      )
                      .map((item, index) => (
                        <div className="tv-menu-row" key={item.id}>
                          <strong
                            className={item.name ? '' : 'is-placeholder'}
                          >
                            {item.name ||
                              (exportTemplate
                                ? ''
                                : `Menu item ${index + 1}`)}
                          </strong>
                          <span className={item.price ? '' : 'is-placeholder'}>
                            {menuPrice(item, 'P-', exportTemplate)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <DrinksCard
                  items={drinks}
                  hidePlaceholders={exportTemplate}
                />
              )}
              <div className="tv-media-card">
                {currentEntry?.kind === 'heat-eat' ? (
                  <div className="tv-heat-card-inner">
                    <HeatEatSlide
                      items={heatEat}
                      title={heatEatTitle}
                      hidePlaceholders={exportTemplate}
                      editable
                      editing={editingTitle === 'heat-eat'}
                      draft={titleDraft}
                      onEdit={() => beginTitleEdit('heat-eat')}
                      onDraft={setTitleDraft}
                      onSave={() => void saveTitle('heat-eat')}
                    />
                  </div>
                ) : (
                  <div className="tv-media-inner">
                    {currentEntry?.kind === 'media' && (
                      <img
                        src={currentEntry.slide.url}
                        alt={currentEntry.slide.file_name}
                      />
                    )}
                    {!currentEntry && (
                      <div className="tv-media-empty">
                        Your offers
                        <br />
                        will appear here
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="tv-social-card">
                <div className="tv-social-copy">
                  Follow us
                  <br />
                  for updates!
                  <br />
                  <strong>@curio.eats</strong>
                </div>
                <div className="tv-qr-box">
                  {qrUrl ? (
                    <img src={qrUrl} alt="Curio QR code" />
                  ) : (
                    <span>
                      Upload
                      <br />
                      QR code
                    </span>
                  )}
                </div>
              </div>
              <img
                className="tv-wave-mascot"
                src={`${publicBase}/assets/wave-mascot.png`}
                alt=""
              />
              <img
                className="tv-point-mascot"
                src={`${publicBase}/assets/point-mascot.png`}
                alt=""
              />
            </article>
          </div>
        </div>
        <div className="tv-export-source" aria-hidden="true">
          <div ref={heatExportRef} className="tv-heat-export-frame">
            <div className="tv-heat-card-inner">
              <HeatEatSlide
                items={heatEat}
                title={heatEatTitle}
                hidePlaceholders
              />
            </div>
          </div>
        </div>
      </section>
      <aside className="editor-pane">
        <div className="editor-header">
          <div className="editor-icon">
            <Tv />
          </div>
          <div>
            <p className="eyebrow">TV generator</p>
            <h2>Build the screen menu</h2>
          </div>
        </div>
        <div className="editor-scroll">
          {message && (
            <div
              className={`status-message${setupNeeded ? ' is-warning' : ''}`}
            >
              {message}
            </div>
          )}
          <section className="settings-section tv-layout-section">
            <div className="section-heading">
              <div>
                <h3>TV menu version</h3>
                <p>
                  Keep the current layout or show the temporary drinks menu.
                </p>
              </div>
            </div>
            <div
              className="tv-layout-toggle"
              role="radiogroup"
              aria-label="TV menu version"
            >
              <button
                type="button"
                role="radio"
                aria-checked={tvLayout === 'no-drinks'}
                className={tvLayout === 'no-drinks' ? 'is-active' : ''}
                onClick={() => {
                  setTvLayout('no-drinks');
                  setActiveSlide(0);
                }}
              >
                No drinks
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={tvLayout === 'drinks'}
                className={tvLayout === 'drinks' ? 'is-active' : ''}
                onClick={() => {
                  setTvLayout('drinks');
                  setActiveSlide(0);
                }}
              >
                With drinks
              </button>
            </div>
          </section>
          <ItemEditor title="Mains" items={mains} setItems={setMains} />
          {tvLayout === 'drinks' && (
            <>
              <DrinkEditor
                section="coffee"
                title="Coffee"
                items={drinks}
                setItems={setDrinks}
              />
              <DrinkEditor
                section="cold"
                title="Cold drinks"
                items={drinks}
                setItems={setDrinks}
              />
            </>
          )}
          <ItemEditor
            title="Heat & Eat"
            items={heatEat}
            setItems={setHeatEat}
          />
          {tvLayout === 'drinks' && (
            <section className="settings-section heat-timing-section">
              <div className="section-heading">
                <div>
                  <h3>Heat & Eat slide timing</h3>
                  <p>This menu rotates in the offer column.</p>
                </div>
                <label className="timing-control">
                  <Input
                    type="number"
                    min="1"
                    max="300"
                    value={heatEatDuration}
                    onChange={(event) =>
                      setHeatEatDuration(
                        Math.min(300, Math.max(1, Number(event.target.value))),
                      )
                    }
                  />
                  <span>sec</span>
                </label>
              </div>
            </section>
          )}
          <section className="settings-section">
            <div className="section-heading">
              <div>
                <h3>Offer slideshow</h3>
                <p>Shared media saved in Supabase</p>
              </div>
              {session && (
                <Button
                  className="add-button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy === 'upload'}
                >
                  <ImagePlus /> Add media
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadMedia(file);
                event.currentTarget.value = '';
              }}
            />
            {slides.length ? (
              <div className="media-editor-list">
                {slides.map((slide, index) => (
                  <div
                    className="media-editor"
                    key={slide.id}
                    draggable={Boolean(session)}
                    onDragStart={(event) =>
                      event.dataTransfer.setData('text/plain', String(index))
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (session)
                        void moveSlide(
                          Number(event.dataTransfer.getData('text/plain')),
                          index,
                        );
                    }}
                  >
                    <GripVertical className="media-grip" />
                    <button
                      className="media-thumb"
                      onClick={() =>
                        setActiveSlide(index + (tvLayout === 'drinks' ? 1 : 0))
                      }
                    >
                      <img src={slide.url} alt="" />
                    </button>
                    <div className="media-meta">
                      <strong title={slide.file_name}>{slide.file_name}</strong>
                      <label>
                        <Input
                          type="number"
                          min="1"
                          max="300"
                          value={slide.duration_seconds}
                          disabled={!session}
                          onChange={(event) =>
                            void updateSlide(slide.id, {
                              duration_seconds: Math.min(
                                300,
                                Math.max(1, Number(event.target.value)),
                              ),
                            })
                          }
                        />
                        <span>sec</span>
                      </label>
                    </div>
                    {session && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="delete-button"
                        disabled={busy === slide.id}
                        onClick={() => void removeSlide(slide)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : session ? (
              <button
                className="empty-library is-upload-ready"
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy === 'upload'}
              >
                <ImagePlus />
                <strong>Upload your first offer</strong>
                <span>PNG, JPG, WebP, or GIF · up to 25 MB</span>
              </button>
            ) : (
              <div className="empty-library">
                No offer media yet. Sign in from the header to add the first
                slide.
              </div>
            )}
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <div>
                <h3>QR code</h3>
                <p>Displayed beside the fixed @curio.eats handle</p>
              </div>
              {session && (
                <Button
                  variant="outline"
                  onClick={() => qrRef.current?.click()}
                  disabled={busy === 'qr'}
                >
                  {qrUrl ? 'Replace' : 'Upload'}
                </Button>
              )}
            </div>
            <input
              ref={qrRef}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadQr(file);
                event.currentTarget.value = '';
              }}
            />
            {qrUrl && (
              <img className="qr-preview" src={qrUrl} alt="Uploaded QR code" />
            )}
          </section>
        </div>
      </aside>
    </main>
  );
}
