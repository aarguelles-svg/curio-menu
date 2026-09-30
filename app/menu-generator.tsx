'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import InstagramMenuGenerator from './instagram-menu-generator';
import type { MenuItem } from './menu-types';
import TvMenuGenerator from './tv-menu-generator';

type GeneratorTab = 'instagram' | 'tv';
type StoredMenus = { mains: MenuItem[]; heatEat: MenuItem[] };

const savedMenusKey = 'curio-menu-items-v1';
const blankItems = () => Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: '', price: '' }));

function normalizeItems(value: unknown): MenuItem[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const items = value.slice(0, 12).map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as { name?: unknown; price?: unknown };
    if (typeof item.name !== 'string' || typeof item.price !== 'string') return null;
    return { id: index + 1, name: item.name, price: item.price.replace(/\D/g, '') };
  });
  return items.every(Boolean) ? items as MenuItem[] : null;
}

function loadLocalMenus(): Partial<StoredMenus> {
  try {
    const saved = JSON.parse(window.localStorage.getItem(savedMenusKey) ?? 'null') as Partial<StoredMenus> | null;
    return {
      mains: normalizeItems(saved?.mains) ?? undefined,
      heatEat: normalizeItems(saved?.heatEat) ?? undefined,
    };
  } catch {
    return {};
  }
}

export default function MenuGenerator() {
  const [tab, setTab] = useState<GeneratorTab>('instagram');
  const [mains, setMains] = useState<MenuItem[]>(blankItems);
  const [heatEat, setHeatEat] = useState<MenuItem[]>(blankItems);
  const [menusLoaded, setMenusLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const latestMenus = useRef({ mains, heatEat });

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const local = loadLocalMenus();
    if (local.mains) setMains(local.mains);
    if (local.heatEat) setHeatEat(local.heatEat);

    void supabase
      .from('tv_settings')
      .select('mains_items, heat_eat_items')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const settings = data as { mains_items?: unknown; heat_eat_items?: unknown } | null;
        const savedMains = normalizeItems(settings?.mains_items);
        const savedHeatEat = normalizeItems(settings?.heat_eat_items);
        if (savedMains) setMains(savedMains);
        if (savedHeatEat) setHeatEat(savedHeatEat);
        setMenusLoaded(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    latestMenus.current = { mains, heatEat };
    if (!menusLoaded) return;
    window.localStorage.setItem(savedMenusKey, JSON.stringify({ mains, heatEat }));
    if (!session) return;
    const timeout = window.setTimeout(() => {
      const current = latestMenus.current;
      void supabase.from('tv_settings').update({
          mains_items: current.mains,
          heat_eat_items: current.heatEat,
          updated_at: new Date().toISOString(),
        }).eq('id', 1).then(({ error }) => {
          if (error) console.error('Could not save the shared menu.', error);
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [mains, heatEat, menusLoaded, session]);

  return (
    <div className="generator-root">
      <nav className="generator-tabs" aria-label="Menu format">
        <div className="generator-brand">Curio menu studio</div>
        <div className="tab-list" role="tablist">
          <button role="tab" aria-selected={tab === 'instagram'} className={tab === 'instagram' ? 'is-active' : ''} onClick={() => setTab('instagram')}>
            Instagram Story
          </button>
          <button role="tab" aria-selected={tab === 'tv'} className={tab === 'tv' ? 'is-active' : ''} onClick={() => setTab('tv')}>
            TV Menu
          </button>
        </div>
      </nav>
      <div className="generator-view">
        <div className="format-panel" role="tabpanel" hidden={tab !== 'instagram'}>
          <InstagramMenuGenerator items={mains} setItems={setMains} />
        </div>
        <div className="format-panel" role="tabpanel" hidden={tab !== 'tv'}>
          <TvMenuGenerator mains={mains} setMains={setMains} heatEat={heatEat} setHeatEat={setHeatEat} />
        </div>
      </div>
    </div>
  );
}
