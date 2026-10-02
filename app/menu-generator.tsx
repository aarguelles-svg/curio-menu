'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Eye, EyeOff, LoaderCircle, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import InstagramMenuGenerator from './instagram-menu-generator';
import type { DrinkItem, MenuItem, TvLayout } from './menu-types';
import TvMenuGenerator from './tv-menu-generator';

type GeneratorTab = 'instagram' | 'tv';
type StoredMenus = {
  mains: MenuItem[];
  heatEat: MenuItem[];
  drinks: DrinkItem[];
  tvLayout: TvLayout;
  heatEatDuration: number;
};

const savedMenusKey = 'curio-menu-items-v1';
const productionUrl = 'https://aarguelles-svg.github.io/curio-menu/';
const blankItems = () =>
  Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    name: '',
    price: '',
  }));
const defaultDrinks = (): DrinkItem[] => [
  {
    id: 1,
    section: 'coffee',
    name: 'Americano',
    subtitle: '',
    showSubtitle: false,
    price: '',
    coldPrice: '',
  },
  {
    id: 2,
    section: 'coffee',
    name: 'Cafe Latte',
    subtitle: '',
    showSubtitle: false,
    price: '',
    coldPrice: '',
  },
  {
    id: 3,
    section: 'coffee',
    name: 'Espresso',
    subtitle: '',
    showSubtitle: false,
    price: '',
    coldPrice: '',
  },
  {
    id: 4,
    section: 'coffee',
    name: 'Cappuccino',
    subtitle: '',
    showSubtitle: false,
    price: '',
    coldPrice: '',
  },
  {
    id: 5,
    section: 'cold',
    name: 'Soda',
    subtitle: '(Coke, Coke Zero, Sprite, Royal)',
    showSubtitle: true,
    price: '75',
    coldPrice: '',
  },
  {
    id: 6,
    section: 'cold',
    name: 'C2 Red',
    subtitle: '',
    showSubtitle: false,
    price: '75',
    coldPrice: '',
  },
  {
    id: 7,
    section: 'cold',
    name: 'Del Monte Pineapple Juice',
    subtitle: '',
    showSubtitle: false,
    price: '80',
    coldPrice: '',
  },
];

function normalizeItems(value: unknown): MenuItem[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const items = value.slice(0, 12).map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as {
      name?: unknown;
      price?: unknown;
      secondPrice?: unknown;
      showSecondPrice?: unknown;
    };
    if (typeof item.name !== 'string' || typeof item.price !== 'string')
      return null;
    return {
      id: index + 1,
      name: item.name,
      price: item.price.replace(/\D/g, ''),
      secondPrice:
        typeof item.secondPrice === 'string'
          ? item.secondPrice.replace(/\D/g, '')
          : '',
      showSecondPrice: Boolean(item.showSecondPrice),
    };
  });
  return items.every(Boolean) ? (items as MenuItem[]) : null;
}

function normalizeDrinks(value: unknown): DrinkItem[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const items = value.slice(0, 12).map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Partial<DrinkItem>;
    if (
      (item.section !== 'coffee' && item.section !== 'cold') ||
      typeof item.name !== 'string'
    )
      return null;
    return {
      id: index + 1,
      section: item.section,
      name: item.name,
      subtitle: typeof item.subtitle === 'string' ? item.subtitle : '',
      showSubtitle: Boolean(item.showSubtitle),
      price:
        typeof item.price === 'string' ? item.price.replace(/\D/g, '') : '',
      coldPrice:
        typeof item.coldPrice === 'string'
          ? item.coldPrice.replace(/\D/g, '')
          : '',
      showSecondPrice: Boolean(item.showSecondPrice),
    };
  });
  return items.every(Boolean) ? (items as DrinkItem[]) : null;
}

function loadLocalMenus(): Partial<StoredMenus> {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(savedMenusKey) ?? 'null',
    ) as Partial<StoredMenus> | null;
    return {
      mains: normalizeItems(saved?.mains) ?? undefined,
      heatEat: normalizeItems(saved?.heatEat) ?? undefined,
      drinks: normalizeDrinks(saved?.drinks) ?? undefined,
      tvLayout:
        saved?.tvLayout === 'drinks'
          ? 'drinks'
          : saved?.tvLayout === 'no-drinks'
            ? 'no-drinks'
            : undefined,
      heatEatDuration:
        typeof saved?.heatEatDuration === 'number'
          ? Math.min(300, Math.max(1, saved.heatEatDuration))
          : undefined,
    };
  } catch {
    return {};
  }
}

function HeaderAuth({ session }: { session: Session | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordMode, setPasswordMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const authType = new URLSearchParams(window.location.hash.slice(1)).get(
      'type',
    );
    if (authType === 'recovery' || authType === 'invite') {
      setPasswordMode(true);
      setOpen(true);
    }
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordMode(true);
        setOpen(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy('auth');
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(null);
    setMessage(error ? error.message : 'Signed in. Shared editing is enabled.');
    if (!error) setPassword('');
  }

  async function requestPasswordReset() {
    if (!email.trim()) return setMessage('Enter your staff email first.');
    setBusy('reset');
    setMessage('Sending password setup email…');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: productionUrl,
    });
    setBusy(null);
    setMessage(
      error
        ? error.message
        : 'Check your email for the secure password setup link.',
    );
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8)
      return setMessage('Use a password with at least 8 characters.');
    if (newPassword !== confirmPassword)
      return setMessage('The two passwords do not match.');
    setBusy('password');
    setMessage('Saving your password…');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(null);
    if (error) return setMessage(error.message);
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMode(false);
    setMessage('Password saved. Shared editing is enabled.');
  }

  return (
    <div className="header-auth">
      <button
        className={`header-auth-trigger${session ? ' is-signed-in' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {session ? (
          <>
            <span className="header-auth-dot" />
            Staff account
          </>
        ) : (
          <>
            <LogIn />
            Sign in
          </>
        )}
      </button>
      {open && (
        <div className="header-auth-popover">
          {session && passwordMode ? (
            <form onSubmit={updatePassword}>
              <div className="header-auth-heading">
                <strong>Set your staff password</strong>
                <span>Create the password used on this site.</span>
              </div>
              <label>
                <span>New password</span>
                <div className="password-control">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    minLength={8}
                    required
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </label>
              <label>
                <span>Confirm password</span>
                <div className="password-control">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    minLength={8}
                    required
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </label>
              <Button
                className="auth-button"
                type="submit"
                disabled={busy === 'password'}
              >
                {busy === 'password' ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <LogIn />
                )}
                {busy === 'password' ? 'Saving…' : 'Save password'}
              </Button>
            </form>
          ) : session ? (
            <div className="header-signed-in">
              <div>
                <strong>Signed in</strong>
                <span>{session.user.email}</span>
              </div>
              <Button
                variant="outline"
                onClick={() => void supabase.auth.signOut()}
              >
                <LogOut />
                Sign out
              </Button>
            </div>
          ) : (
            <form onSubmit={signIn}>
              <div className="header-auth-heading">
                <strong>Staff sign in</strong>
                <span>Required to save shared changes.</span>
              </div>
              <label>
                <span>Email</span>
                <Input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="header-auth-password">
                <span>Password</span>
                <div className="password-control">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
                <button
                  className="forgot-password"
                  type="button"
                  disabled={busy === 'reset'}
                  onClick={() => void requestPasswordReset()}
                >
                  {busy === 'reset' ? 'Sending…' : 'Forgot password?'}
                </button>
              </label>
              <div className="header-auth-actions">
                <Button
                  className="auth-button"
                  type="submit"
                  disabled={busy === 'auth'}
                >
                  <LogIn />
                  {busy === 'auth' ? 'Signing in…' : 'Sign in'}
                </Button>
              </div>
            </form>
          )}
          {message && (
            <p className="header-auth-message" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MenuGenerator() {
  const [tab, setTab] = useState<GeneratorTab>('tv');
  const [mains, setMains] = useState<MenuItem[]>(blankItems);
  const [heatEat, setHeatEat] = useState<MenuItem[]>(blankItems);
  const [drinks, setDrinks] = useState<DrinkItem[]>(defaultDrinks);
  const [tvLayout, setTvLayout] = useState<TvLayout>('no-drinks');
  const [heatEatDuration, setHeatEatDuration] = useState(10);
  const [menusLoaded, setMenusLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const latestMenus = useRef({
    mains,
    heatEat,
    drinks,
    tvLayout,
    heatEatDuration,
  });

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
    if (local.drinks) setDrinks(local.drinks);
    if (local.tvLayout) setTvLayout(local.tvLayout);
    if (local.heatEatDuration) setHeatEatDuration(local.heatEatDuration);

    void supabase
      .from('tv_settings')
      .select('mains_items, heat_eat_items')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const settings = data as {
          mains_items?: unknown;
          heat_eat_items?: unknown;
        } | null;
        const savedMains = normalizeItems(settings?.mains_items);
        const savedHeatEat = normalizeItems(settings?.heat_eat_items);
        if (savedMains) setMains(savedMains);
        if (savedHeatEat) setHeatEat(savedHeatEat);
        setMenusLoaded(true);
      });

    void supabase
      .from('tv_settings')
      .select('drinks_items, tv_layout, heat_eat_duration_seconds')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const settings = data as {
          drinks_items?: unknown;
          tv_layout?: unknown;
          heat_eat_duration_seconds?: unknown;
        };
        const savedDrinks = normalizeDrinks(settings.drinks_items);
        if (savedDrinks) setDrinks(savedDrinks);
        if (
          settings.tv_layout === 'drinks' ||
          settings.tv_layout === 'no-drinks'
        )
          setTvLayout(settings.tv_layout);
        if (typeof settings.heat_eat_duration_seconds === 'number')
          setHeatEatDuration(
            Math.min(300, Math.max(1, settings.heat_eat_duration_seconds)),
          );
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    latestMenus.current = { mains, heatEat, drinks, tvLayout, heatEatDuration };
    if (!menusLoaded) return;
    window.localStorage.setItem(
      savedMenusKey,
      JSON.stringify({ mains, heatEat, drinks, tvLayout, heatEatDuration }),
    );
    if (!session) return;
    const timeout = window.setTimeout(() => {
      const current = latestMenus.current;
      void supabase
        .from('tv_settings')
        .update({
          mains_items: current.mains,
          heat_eat_items: current.heatEat,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
        .then(({ error }) => {
          if (error) console.error('Could not save the shared menu.', error);
        });
      void supabase
        .from('tv_settings')
        .update({
          drinks_items: current.drinks,
          tv_layout: current.tvLayout,
          heat_eat_duration_seconds: current.heatEatDuration,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1)
        .then(({ error }) => {
          if (error)
            console.error('Could not save the shared drinks layout.', error);
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [mains, heatEat, drinks, tvLayout, heatEatDuration, menusLoaded, session]);

  return (
    <div className="generator-root">
      <nav className="generator-tabs" aria-label="Menu format">
        <div className="generator-brand">Curio menu studio</div>
        <div className="generator-nav-actions">
          <div className="tab-list" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'instagram'}
              className={tab === 'instagram' ? 'is-active' : ''}
              onClick={() => setTab('instagram')}
            >
              Instagram Story
            </button>
            <button
              role="tab"
              aria-selected={tab === 'tv'}
              className={tab === 'tv' ? 'is-active' : ''}
              onClick={() => setTab('tv')}
            >
              TV Menu
            </button>
          </div>
          <HeaderAuth session={session} />
        </div>
      </nav>
      <div className="generator-view">
        <div
          className="format-panel"
          role="tabpanel"
          hidden={tab !== 'instagram'}
        >
          <InstagramMenuGenerator items={mains} setItems={setMains} />
        </div>
        <div className="format-panel" role="tabpanel" hidden={tab !== 'tv'}>
          <TvMenuGenerator
            session={session}
            mains={mains}
            setMains={setMains}
            heatEat={heatEat}
            setHeatEat={setHeatEat}
            drinks={drinks}
            setDrinks={setDrinks}
            tvLayout={tvLayout}
            setTvLayout={setTvLayout}
            heatEatDuration={heatEatDuration}
            setHeatEatDuration={setHeatEatDuration}
          />
        </div>
      </div>
    </div>
  );
}
