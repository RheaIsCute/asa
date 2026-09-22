import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TxBackground from './TxBackground.jsx';
import './tx.css';
import './crypto-guide.css';

/**
 * Every chain shown here is one BlockCypher's free, keyless `/addrs/`
 * endpoint actually supports, matching what `guessCoin`/`fetchBalance` in
 * the bot's src/coins.js use server-side. No API key travels to the browser.
 */
const COIN_META = {
  btc: { name: 'Bitcoin', id: 'bitcoin', decimals: 8 },
  ltc: { name: 'Litecoin', id: 'litecoin', decimals: 8 },
  doge: { name: 'Dogecoin', id: 'dogecoin', decimals: 8 },
  dash: { name: 'Dash', id: 'dash', decimals: 8 },
  eth: { name: 'Ethereum', id: 'ethereum', decimals: 18 },
};
const DEFAULT_COIN = 'ltc';
const RECEIPT_BASE = 'https://asarii.xyz/tx/';
const PREFIX_RULES = [
  ['0x', 'eth'], ['bc1', 'btc'], ['ltc1', 'ltc'], ['1', 'btc'], ['3', 'btc'],
  ['l', 'ltc'], ['m', 'ltc'], ['d', 'doge'], ['x', 'dash'],
];

const guessCoin = (address) => {
  const lower = String(address || '').toLowerCase();
  const hit = PREFIX_RULES.find(([prefix]) => lower.startsWith(prefix));
  return hit ? hit[1] : DEFAULT_COIN;
};

const explorerUrl = (coin, txid) =>
  `https://blockchair.com/${COIN_META[coin]?.id || coin}/transaction/${txid}`;
const receiptOrExplorer = (coin, txid) => (coin === 'ltc' ? `${RECEIPT_BASE}${txid}` : explorerUrl(coin, txid));

const shortAddr = (value = '', left = 10, right = 8) =>
  value.length > left + right ? `${value.slice(0, left)}…${value.slice(-right)}` : value;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Live snapshot for one address, on the same public endpoints the bot uses. */
async function fetchWalletSnapshot(coin, address, signal) {
  const meta = COIN_META[coin] || COIN_META[DEFAULT_COIN];
  const addrReq = fetch(`https://api.blockcypher.com/v1/${coin}/main/addrs/${encodeURIComponent(address)}`, { signal });
  const priceReq = fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${meta.id}&vs_currencies=usd`, { signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const addrRes = await addrReq;
  if (!addrRes.ok) throw new Error(addrRes.status === 404 ? 'not-found' : 'lookup-failed');
  const data = await addrRes.json();
  const price = (await priceReq)?.[meta.id]?.usd ?? null;

  const divisor = 10 ** meta.decimals;
  const confirmed = (data.balance || 0) / divisor;
  const unconfirmed = (data.unconfirmed_balance || 0) / divisor;
  const totalReceived = (data.total_received || 0) / divisor;
  const toUsd = (amount) => (typeof price === 'number' ? amount * price : null);

  return {
    coin,
    meta,
    price,
    confirmed,
    unconfirmed,
    totalReceived,
    usd: { confirmed: toUsd(confirmed), unconfirmed: toUsd(unconfirmed), totalReceived: toUsd(totalReceived) },
    txCount: data.n_tx ?? (data.txrefs || []).length,
    transactions: (data.txrefs || []).slice(0, 5).map((tx) => tx.tx_hash),
  };
}

/** Eases a number up to `target` whenever `active` flips on. Mirrors the receipt page's count-up. */
function useCountUp(target, active, duration = 1300) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const still = useMemo(() => reducedMotion(), []);

  useEffect(() => {
    if (!active || typeof target !== 'number' || still) return undefined;
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 4;
      const next = from + (target - from) * eased;
      setValue(next);
      fromRef.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration, still]);

  if (!active) return 0;
  return still ? target : value;
}

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** Two pulses travel the rail while a lookup is in flight — request out, response back. */
function LedgerPulse({ state }) {
  const outPath = 'M20,44 C86,44 96,44 160,44 C224,44 234,44 300,44';
  const backPath = 'M300,44 C234,44 224,44 160,44 C96,44 86,44 20,44';
  const live = state === 'loading';
  return (
    <div className={`cg-pulse is-${state}`} aria-hidden="true">
      <svg viewBox="0 0 320 88" width="100%" height="88" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="cg-pulse-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--violet)" />
            <stop offset="100%" stopColor="var(--lime)" />
          </linearGradient>
        </defs>
        <path d={outPath} className="cg-pulse-rail" />
        <circle cx="20" cy="44" r="8" className="cg-pulse-node from" />
        <circle cx="160" cy="44" r="10" className="cg-pulse-node mid" />
        <circle cx="300" cy="44" r="8" className="cg-pulse-node to" />
        {live && (
          <circle r="4.5" className="cg-pulse-dot out">
            <animateMotion dur="1.5s" repeatCount="indefinite" path={outPath} />
          </circle>
        )}
        {live && (
          <circle r="4.5" className="cg-pulse-dot back">
            <animateMotion dur="1.5s" begin="0.75s" repeatCount="indefinite" path={backPath} />
          </circle>
        )}
        {state === 'ready' && <circle cx="160" cy="44" r="15" className="cg-pulse-ring" />}
      </svg>
      <div className="cg-pulse-labels">
        <span>Your address</span>
        <span>Public ledger</span>
        <span>Answer</span>
      </div>
    </div>
  );
}

function AddressChunks({ address, animate }) {
  const chunks = useMemo(() => address.match(/.{1,4}/g) || [], [address]);
  return (
    <div className={`cg-addr-chunks${animate ? ' is-in' : ''}`} aria-label={address}>
      {chunks.map((chunk, i) => (
        <span key={i} style={{ animationDelay: `${i * 30}ms` }}>{chunk}</span>
      ))}
    </div>
  );
}

function StatTile({ label, value, unit, usd, active, loading, hint }) {
  const shown = useCountUp(value, active);
  return (
    <div className={`cg-stat${loading ? ' is-loading' : ''}`} title={hint}>
      <span className="cg-stat-label">{label}</span>
      {active ? (
        <b className="cg-stat-value">{shown.toFixed(8)}<i>{unit}</i></b>
      ) : (
        <b className="cg-stat-value cg-stat-placeholder" aria-hidden="true">&nbsp;</b>
      )}
      <small className="cg-stat-usd">{active && usd != null ? `≈ $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</small>
    </div>
  );
}

function ActivityList({ coin, hashes, animate }) {
  if (!hashes.length) {
    return <p className="cg-empty">No public transactions on record for this address yet.</p>;
  }
  return (
    <ul className="cg-activity">
      {hashes.map((hash, i) => (
        <li key={hash} className={animate ? 'is-in' : ''} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="cg-activity-index">0{i + 1}</span>
          <code>{hash.slice(0, 10)}…{hash.slice(-8)}</code>
          <a href={receiptOrExplorer(coin, hash)} target="_blank" rel="noreferrer">
            {coin === 'ltc' ? 'Live receipt' : 'Explorer'} <span>↗</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

const CONCEPTS = [
  ['Wallet address', 'A public account number for a chain. Anyone can look up its activity; it never reveals the private key that controls it.'],
  ['Transaction hash', 'A public receipt ID, unique to one transaction. Paste it into an explorer to see whether it exists, succeeded, and moved what you expect.'],
  ['Confirmed vs. unconfirmed', 'Unconfirmed balance is still sitting in the mempool, waiting to be mined into a block. Confirmed balance has cleared that step and is considered settled.'],
  ['Network fee', 'A small payment to the miners/validators who process a transaction. It comes out of the sender’s balance, not the receiver’s.'],
  ['Block explorer', 'A public website that reads a blockchain and renders it as something a browser can display — exactly what this page and asarii.xyz/tx do for Litecoin.'],
];

const STEPS = [
  { id: 'address', n: '01', label: 'The address' },
  { id: 'ledger', n: '02', label: 'Checking the ledger' },
  { id: 'activity', n: '03', label: 'Recent activity' },
  { id: 'verify', n: '04', label: 'Verify it yourself' },
];

export default function CryptoGuide() {
  const initial = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const address = (params.get('a') || params.get('address') || '').trim();
    const coinParam = (params.get('c') || params.get('coin') || '').toLowerCase();
    const coin = COIN_META[coinParam] ? coinParam : guessCoin(address);
    return { address, coin };
  }, []);

  const [address, setAddress] = useState(initial.address);
  const [coin, setCoin] = useState(initial.coin);
  // Keyed by the address/coin it was fetched for, so "loading" for a new
  // lookup is derived at render time instead of set imperatively in the effect.
  const [result, setResult] = useState({ address: '', coin: '', status: 'idle', snapshot: null });
  const [active, setActive] = useState('address');
  const [openConcept, setOpenConcept] = useState(0);
  const [toast, setToast] = useState('');
  const [formAddress, setFormAddress] = useState(initial.address);
  const [formCoin, setFormCoin] = useState(initial.address ? initial.coin : '');

  const sectionRefs = useRef({});

  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2000);
  }, []);

  const copy = useCallback(async (value, message) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify('Clipboard unavailable');
    }
  }, [notify]);

  /* ── Fetch a fresh snapshot whenever the address/coin changes ── */
  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    const controller = new AbortController();
    fetchWalletSnapshot(coin, address, controller.signal)
      .then((data) => { if (alive) setResult({ address, coin, status: 'ready', snapshot: data }); })
      .catch((err) => {
        if (!alive) return;
        setResult({ address, coin, status: err.message === 'not-found' ? 'empty' : 'error', snapshot: null });
      });
    return () => { alive = false; controller.abort(); };
  }, [address, coin]);

  // The fetch above targets the address/coin at the time it started; while a
  // newer lookup is in flight, the stale result is simply not "current" yet.
  const isCurrent = result.address === address && result.coin === coin;
  const status = !address ? 'idle' : (isCurrent ? result.status : 'loading');
  const snapshot = isCurrent ? result.snapshot : null;

  /* ── Track which layer is on screen to drive the stepper + reveals ── */
  useEffect(() => {
    const nodes = Object.values(sectionRefs.current).filter(Boolean);
    if (!nodes.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          if (entry.intersectionRatio > 0.4) setActive(entry.target.dataset.step);
        }
      });
    }, { threshold: [0.1, 0.4, 0.7] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [status]);

  const goToStep = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  const handleLookup = (event) => {
    event.preventDefault();
    const addr = formAddress.trim();
    if (!addr) return;
    const nextCoin = COIN_META[formCoin] ? formCoin : guessCoin(addr);
    window.history.replaceState({}, '', `/crypto?a=${encodeURIComponent(addr)}&c=${nextCoin}`);
    setAddress(addr);
    setCoin(nextCoin);
  };

  const meta = COIN_META[coin] || COIN_META[DEFAULT_COIN];
  const ready = status === 'ready' && !!snapshot;
  const stepIndex = STEPS.findIndex((s) => s.id === active);

  return (
    <main className="cg-page">
      <TxBackground />

      <header className="cg-header">
        <a className="cg-brand" href="/">asarii.xyz</a>
        <span className={`cg-live tx-status ${status === 'loading' ? 'is-loading' : status === 'error' ? 'is-error' : ''}`}>
          <i className="tx-dot" />
          {status === 'idle' && 'WAITING FOR AN ADDRESS'}
          {status === 'loading' && 'CONTACTING THE LEDGER'}
          {status === 'ready' && 'LIVE DATA'}
          {status === 'empty' && `NO ${meta.name.toUpperCase()} ACTIVITY FOUND`}
          {status === 'error' && 'LOOKUP FAILED'}
        </span>
      </header>

      <section className="cg-hero">
        <p className="cg-kicker">NO JARGON · LIVE PUBLIC CHAIN DATA</p>
        <h1>Follow a wallet,<br /><em>one layer at a time.</em></h1>
        <p>
          This page explains what actually happens when a crypto address is checked — using
          real, live data for whichever address you (or the bot’s <code>wbal</code> command) point it at.
          Nothing here is prerecorded.
        </p>

        {status === 'idle' && (
          <form className="cg-lookup" onSubmit={handleLookup}>
            <input
              className="tx-input"
              placeholder="Paste a wallet address…"
              value={formAddress}
              onChange={(e) => setFormAddress(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <select className="cg-select" value={formCoin} onChange={(e) => setFormCoin(e.target.value)}>
              <option value="">Auto-detect chain</option>
              {Object.entries(COIN_META).map(([sym, m]) => (
                <option key={sym} value={sym}>{m.name}</option>
              ))}
            </select>
            <button type="submit" className="tx-btn">Check it</button>
          </form>
        )}
        {status === 'idle' && (
          <p className="cg-lookup-hint">Or run <code>wbal &lt;address&gt;</code> in Discord — it links straight back here with the result.</p>
        )}
      </section>

      {/* ── Stepper ── */}
      <nav className="cg-stepper" aria-label="Guide layers">
        <div className="cg-stepper-rail" aria-hidden="true">
          <span style={{ width: `${stepIndex >= 0 ? (stepIndex / (STEPS.length - 1)) * 100 : 0}%` }} />
        </div>
        {STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            className={`cg-stepper-btn ${active === step.id ? 'is-active' : ''}`}
            onClick={() => goToStep(step.id)}
          >
            <span className="cg-stepper-n">{step.n}</span>{step.label}
          </button>
        ))}
      </nav>

      {/* ── Layer 1: the address ── */}
      <section
        id="address"
        className="cg-section"
        data-step="address"
        ref={(el) => { sectionRefs.current.address = el; }}
      >
        <div className="cg-section-head">
          <div><p className="cg-kicker">LAYER 01</p><h2>An address is public, on purpose</h2></div>
        </div>
        <p className="cg-section-copy">
          Every wallet has an address — think of it like an account number. Anyone can look up what has
          moved through it. That is not a leak or a bug; it is how a public ledger proves things happened
          without needing a bank in the middle.
        </p>
        {address ? (
          <div className="cg-address-card">
            <div className="cg-address-top">
              <span className="cg-chain-badge">{meta.name}</span>
              <button type="button" className="tx-copyable" onClick={() => copy(address, 'Address copied')}>
                <code>{shortAddr(address, 14, 10)}</code>
                <CopyIcon />
              </button>
            </div>
            <AddressChunks address={address} animate />
            <p className="cg-address-note">Public: activity history. Private: nothing — the key that spends from this address is never shown here or on any explorer.</p>
          </div>
        ) : (
          <div className="cg-address-card is-empty">
            <p>Paste an address above (or send it through <code>wbal</code>) and it will appear here, broken into readable chunks.</p>
          </div>
        )}
      </section>

      {/* ── Layer 2: checking the ledger ── */}
      <section
        id="ledger"
        className="cg-section"
        data-step="ledger"
        ref={(el) => { sectionRefs.current.ledger = el; }}
      >
        <div className="cg-section-head">
          <div><p className="cg-kicker">LAYER 02</p><h2>Ask the network, get an answer</h2></div>
        </div>
        <p className="cg-section-copy">
          Checking a balance means asking the network to add up every payment the address has ever
          received and subtract every payment it sent. There is no account to log into — the ledger
          itself is the source of truth.
        </p>
        <LedgerPulse state={status} />
        {status === 'error' && (
          <p className="cg-empty is-error">Could not reach a public ledger for this chain/address right now. Try again in a moment.</p>
        )}
        <div className="cg-stats">
          <StatTile
            label="Confirmed"
            value={snapshot?.confirmed}
            unit={coin.toUpperCase()}
            usd={snapshot?.usd.confirmed}
            active={ready}
            loading={status === 'loading'}
            hint="Settled balance — already mined into a block."
          />
          <StatTile
            label="Unconfirmed"
            value={snapshot?.unconfirmed}
            unit={coin.toUpperCase()}
            usd={snapshot?.usd.unconfirmed}
            active={ready}
            loading={status === 'loading'}
            hint="Still in the mempool, waiting to be mined."
          />
          <StatTile
            label="Total received"
            value={snapshot?.totalReceived}
            unit={coin.toUpperCase()}
            usd={snapshot?.usd.totalReceived}
            active={ready}
            loading={status === 'loading'}
            hint="Everything this address has ever received, lifetime."
          />
        </div>
      </section>

      {/* ── Layer 3: recent activity ── */}
      <section
        id="activity"
        className="cg-section"
        data-step="activity"
        ref={(el) => { sectionRefs.current.activity = el; }}
      >
        <div className="cg-section-head">
          <div><p className="cg-kicker">LAYER 03</p><h2>What the ledger has recorded</h2></div>
          {ready && <span className="cg-count">{snapshot.txCount} total transaction{snapshot.txCount === 1 ? '' : 's'}</span>}
        </div>
        <p className="cg-section-copy">Each entry below is a real, independently-verifiable record — not something this page generated.</p>
        {ready ? (
          <ActivityList coin={coin} hashes={snapshot.transactions} animate />
        ) : (
          <div className="cg-activity-skeleton">
            {[0, 1, 2].map((i) => <div key={i} className="tx-bone" style={{ animationDelay: `${i * 120}ms` }} />)}
          </div>
        )}
      </section>

      {/* ── Layer 4: verify it yourself ── */}
      <section
        id="verify"
        className="cg-section"
        data-step="verify"
        ref={(el) => { sectionRefs.current.verify = el; }}
      >
        <div className="cg-section-head">
          <div><p className="cg-kicker">LAYER 04</p><h2>You never have to take our word for it</h2></div>
        </div>
        <p className="cg-section-copy">
          A transaction hash is a receipt ID. Open it in any explorer — or, for Litecoin, the live
          receipt page below — and it will show the same confirmations, amounts and addresses
          independently. If a hash does not resolve on-chain, it is not proof of anything.
        </p>
        <div className="cg-verify-actions">
          {ready && snapshot.transactions[0] ? (
            <a className="tx-btn" href={receiptOrExplorer(coin, snapshot.transactions[0])} target="_blank" rel="noreferrer">
              Open a real record from this address <span>↗</span>
            </a>
          ) : (
            <span className="tx-btn ghost is-disabled">A verifiable record will appear here once a lookup succeeds</span>
          )}
          {coin === 'ltc' && (
            <a className="tx-btn ghost" href="/tx" target="_blank" rel="noreferrer">Look up any Litecoin hash</a>
          )}
        </div>
      </section>

      {/* ── Glossary ── */}
      <section className="cg-basics" aria-labelledby="basics-title">
        <div><p className="cg-kicker">CRYPTO BASICS</p><h2 id="basics-title">Five terms worth knowing</h2></div>
        <div className="cg-concepts">
          {CONCEPTS.map(([term, meaning], index) => (
            <article className={openConcept === index ? 'is-open' : ''} key={term}>
              <button type="button" onClick={() => setOpenConcept(openConcept === index ? -1 : index)} aria-expanded={openConcept === index}>
                <span>0{index + 1}</span>{term}<b>+</b>
              </button>
              <div className="cg-concept-body"><p>{meaning}</p></div>
            </article>
          ))}
        </div>
      </section>

      <aside className="cg-safety">
        <strong>Quick safety rule</strong>
        <p>Never pay a “release fee,” “verification fee,” or “tax” to unlock crypto. A real transaction can be verified independently, right here, and never requires giving anyone your recovery phrase or private key.</p>
      </aside>

      {toast && (
        <div className="tx-toast" role="status">
          <CheckIcon /> {toast}
        </div>
      )}
    </main>
  );
}
