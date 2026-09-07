import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

// Every route is lazy: whichever page you land on is the only one you download.
const Experience = lazy(() => import('./Experience.jsx'));
const HookloaderPage = lazy(() =>
  import('./Hookloader.jsx').then((m) => ({ default: m.HookloaderPage }))
);
const TransactionPage = lazy(() => import('./TransactionPage.jsx'));

// ═══════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════

const HOOKLOADER_PATTERN = /(hookloader|download|projects)/;
// Only direct receipt links render the transaction page. /tx itself stays on the home experience.
const TRANSACTION_PATTERN = /^\/tx\/([a-f0-9]{16,})\/?$/i;

const readRoute = () => {
  if (typeof window === 'undefined') return 'main';
  const target = `${window.location.pathname}${window.location.hash}`.toLowerCase();
  if (TRANSACTION_PATTERN.test(window.location.pathname)) return 'transaction';
  return HOOKLOADER_PATTERN.test(target) ? 'hookloader' : 'main';
};

const readTransactionId = () => {
  if (typeof window === 'undefined') return '';
  return window.location.pathname.match(TRANSACTION_PATTERN)?.[1] || '';
};

/** Read directly rather than via scene.jsx, which would pull in three.js. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function App() {
  const [route, setRoute] = useState(readRoute);

  const navigate = useCallback((path) => {
    window.history.pushState({}, '', path);
    setRoute(readRoute());
  }, []);

  useEffect(() => {
    const onLocationChange = () => setRoute(readRoute());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  if (route === 'hookloader') {
    return (
      <Suspense fallback={<div className="hl-page" />}>
        <HookloaderPage onNavigateHome={() => navigate('/')} reducedMotion={prefersReducedMotion()} />
      </Suspense>
    );
  }

  if (route === 'transaction') {
    return (
      <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#08050d' }} />}>
        <TransactionPage txid={readTransactionId()} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#050505' }} />}>
      <Experience />
    </Suspense>
  );
}
