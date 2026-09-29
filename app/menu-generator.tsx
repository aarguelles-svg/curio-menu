'use client';

import { useState } from 'react';
import InstagramMenuGenerator from './instagram-menu-generator';
import TvMenuGenerator from './tv-menu-generator';

type GeneratorTab = 'instagram' | 'tv';

export default function MenuGenerator() {
  const [tab, setTab] = useState<GeneratorTab>('instagram');

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
          <InstagramMenuGenerator />
        </div>
        <div className="format-panel" role="tabpanel" hidden={tab !== 'tv'}>
          <TvMenuGenerator />
        </div>
      </div>
    </div>
  );
}
