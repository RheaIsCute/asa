import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TxBackground from './TxBackground.jsx';
import TxSigil from './TxSigil.jsx';
import './tx.css';

const API_ROOT = 'https://api.blockcypher.com/v1/ltc/main/txs/';
const PRICE_API = 'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd';
const EXPLORER = 'https://live.blockcypher.com/ltc/tx/';
/** Litecoin is widely treated as settled at six confirmations. */
const FINALITY = 6;
/** How often an unconfirmed transaction is re-checked. */
const POLL_MS = 20_000;

const TXID_RE = /^[a-f0-9]{16,}$/i;

const short = (value = '', left = 12, right = 10) =>
  value.length > left + right ? `${value.slice(0, left)}…${value.slice(-right)}` : value;

const toLtc = (satoshis = 0) => Number(satoshis) / 100_000_000;
const formatLtc = (satoshis = 0) => toLtc(satoshis).toFixed(8);
const formatUsd = (amount) =>
  amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Small building blocks ─────────────────────────────── */

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** Eases a number up to `target` whenever the target changes. */
function useCountUp(target, duration = 1400) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  // Read once: the animation is skipped wholesale rather than per-frame.
  const still = useMemo(() => reducedMotion(), []);

  useEffect(() => {
    if (!Number.isFinite(target) || still) return undefined;
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
  }, [target, duration, still]);

  return still ? target : value;
}

/** Radial confirmation meter. */
function ConfirmationRing({ confirmations }) {
  const ratio = Math.max(0, Math.min(confirmations / FINALITY, 1));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const done = ratio >= 1;

  return (
    <div className="tx-ring">
      <svg width="72" height="72">
        <circle className="track" cx="36" cy="36" r={radius} strokeWidth="4" />
        <circle
          className={`fill${done ? ' done' : ''}`}
          cx="36"
          cy="36"
          r={radius}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="tx-ring-label">
        <b>{confirmations > 999 ? `${Math.floor(confirmations / 1000)}k` : confirmations}</b>
        <span>{done ? 'SETTLED' : `OF ${FINALITY}`}</span>
      </span>
    </div>
  );
}

/**
 * Sankey-ish value flow. Inputs on the left, outputs on the right, with a
 * pulse travelling each link so the value visibly "moves".
 *
 * The boxes are real DOM nodes (SVG text goes blurry once the diagram is
 * scaled to fit) and the links are measured from their laid-out positions,
 * so the curves stay attached at any container width.
 */
function FlowDiagram({ inputs, outputs }) {
  const MAX = 4;
  const wrapRef = useRef(null);
  const inRefs = useRef([]);
  const outRefs = useRef([]);
  const [links, setLinks] = useState([]);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const columns = useMemo(() => {
    const build = (items) => {
      const shown = items.slice(0, MAX);
      const hidden = items.length - shown.length;
      return hidden > 0 ? [...shown, { more: hidden }] : shown;
    };
    return { in: build(inputs), out: build(outputs) };
  }, [inputs, outputs]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    // ResizeObserver fires once on observe, which doubles as the first measure.
    const observer = new ResizeObserver(() => {
      const base = wrap.getBoundingClientRect();
      const next = [];

      inRefs.current.forEach((from) => {
        if (!from) return;
        const a = from.getBoundingClientRect();
        outRefs.current.forEach((to) => {
          if (!to) return;
          const b = to.getBoundingClientRect();
          const x1 = a.right - base.left;
          const y1 = a.top + a.height / 2 - base.top;
          const x2 = b.left - base.left;
          const y2 = b.top + b.height / 2 - base.top;
          const bend = Math.max(28, (x2 - x1) * 0.42);
          next.push(`M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`);
        });
      });

      setBox({ width: base.width, height: base.height });
      setLinks(next);
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, [columns]);

  const renderColumn = (nodes, side, refs) => (
    <div className={`tx-flow-col ${side}`}>
      {nodes.map((node, i) => (
        <div
          key={`${side}-${i}`}
          ref={(el) => { refs.current[i] = el; }}
          className={`tx-node ${side}${node.more ? ' more' : ''}`}
        >
          {node.more ? (
            <span className="addr">+{node.more} more</span>
          ) : (
            <>
              <span className="addr">{short(node.address, 10, 8)}</span>
              <span className="val">{toLtc(node.value).toFixed(4)} LTC</span>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="tx-flow-map" ref={wrapRef}>
      <svg
        className="tx-flow-links"
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${box.width || 1} ${box.height || 1}`}
        aria-hidden="true"
      >
        {links.map((d, i) => (
          <path key={`l-${i}`} className="tx-link" d={d} />
        ))}
        {links.slice(0, 10).map((d, i) => (
          <path key={`g-${i}`} className="tx-link-glow" d={d} style={{ animationDelay: `${i * 0.3}s` }} />
        ))}
      </svg>
      {renderColumn(columns.in, 'in', inRefs)}
      {renderColumn(columns.out, 'out', outRefs)}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────── */

export default function TransactionPage({ txid, onNavigate }) {
  const [record, setRecord] = useState(null);
  const [failure, setFailure] = useState(null);
  const [price, setPrice] = useState(null);
  const [toast, setToast] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [lookup, setLookup] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [progress, setProgress] = useState(0);


  const notify = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2000);
  }, []);

  // Only surface data that belongs to the hash currently in the URL.
  const tx = record && record.id === txid ? record.data : null;
  const error = failure && failure.id === txid ? failure.message : '';

  /* ── Fetch the transaction, and keep polling while unconfirmed ── */
  useEffect(() => {
    if (!txid) return undefined;

    let active = true;
    let timer = 0;

    const load = () => {
      fetch(`${API_ROOT}${encodeURIComponent(txid)}`)
        .then((response) => {
          if (!response.ok) throw new Error('not found');
          return response.json();
        })
        .then((data) => {
          if (!active) return;
          setRecord({ id: txid, data });
          // Keep watching until the transaction settles.
          if ((data.confirmations || 0) < FINALITY) {
            timer = window.setTimeout(load, POLL_MS);
          }
        })
        .catch(() => {
          if (active) setFailure({ id: txid, message: 'We could not find that Litecoin transaction.' });
        });
    };

    load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [txid]);

  /* ── LTC spot price, best-effort ── */
  useEffect(() => {
    let active = true;
    fetch(PRICE_API)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const usd = data?.litecoin?.usd;
        if (active && typeof usd === 'number') setPrice(usd);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  /* ── Scroll rail ── */
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max <= 0 ? 0 : Math.min(window.scrollY / max, 1));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const totals = useMemo(() => {
    if (!tx) return { input: 0, output: 0 };
    return {
      input: (tx.inputs || []).reduce((sum, item) => sum + (item.output_value || 0), 0),
      output: (tx.outputs || []).reduce((sum, item) => sum + (item.value || 0), 0),
    };
  }, [tx]);

  const parties = useMemo(() => ({
    inputs: (tx?.inputs || []).map((item) => ({
      address: item.addresses?.[0] || 'Unknown',
      value: item.output_value || 0,
    })),
    outputs: (tx?.outputs || []).map((item) => ({
      address: item.addresses?.[0] || 'OP_RETURN',
      value: item.value || 0,
    })),
  }), [tx]);

  const confirmations = tx?.confirmations || 0;
  const animatedLtc = useCountUp(toLtc(totals.output), 1500);
  const animatedUsd = useCountUp(price ? toLtc(totals.output) * price : 0, 1700);

  const copy = useCallback(async (value, message) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify('Clipboard unavailable');
    }
  }, [notify]);

  const submitLookup = (event) => {
    event.preventDefault();
    const value = lookup.trim().replace(/^.*\/tx\//, '');
    if (!TXID_RE.test(value)) {
      setLookupError('That does not look like a Litecoin transaction hash.');
      return;
    }
    setLookupError('');
    onNavigate?.(`/tx/${value.toLowerCase()}`);
  };

  const status = error
    ? { className: 'is-error', label: 'NOT FOUND' }
    : !txid
      ? { className: 'is-loading', label: 'AWAITING HASH' }
      : !tx
        ? { className: 'is-loading', label: 'FETCHING' }
        : confirmations >= FINALITY
          ? { className: '', label: 'CONFIRMED' }
          : { className: 'is-pending', label: confirmations > 0 ? 'CONFIRMING' : 'IN MEMPOOL' };

  const headline = error ? 'Receipt unavailable.' : !txid ? 'Follow your transfer.' : !tx ? 'loading.' : confirmations >= FINALITY ? 'confirmed.' : 'confirming.';

  return (
    <main className="tx-page">
      <TxBackground />
      <div className="tx-rail" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>

      <header className="tx-header">
        <a className="tx-brand" href="/" aria-label="Back to ASARII home">
          <span className="tx-mark">A</span>
          <span>ASARII<span className="tx-brand-muted"> / TX</span></span>
        </a>
        <span className="tx-network">
          <i className="tx-dot" />
          LITECOIN MAINNET
          {tx?.block_height > 0 && <b className="tx-height"># {tx.block_height.toLocaleString()}</b>}
        </span>
      </header>

      <section className="tx-shell">
        <div className="tx-kicker tx-in"><i /> TRANSACTION RECEIPT</div>

        <h1 className="tx-title tx-in tx-d1">
          {error || !txid ? headline : <>Transfer <em>{headline}</em></>}
        </h1>

        <p className="tx-intro tx-in tx-d2">
          {txid
            ? 'A public, read-only record of a Litecoin transaction, pulled live from the chain. No keys, no custody, nothing to sign.'
            : 'Check confirmations, trace the transfer, and share a live receipt. All you need is a Litecoin transaction hash.'}
        </p>

        <div className="tx-card tx-in tx-d3">
          <div className="tx-card-top">
            <div>
              <span className="tx-label">{txid ? 'TRANSACTION ID' : 'LITECOIN RECEIPT LOOKUP'}</span>
              {txid ? (
                <button type="button" className="tx-copyable" onClick={() => copy(txid, 'Transaction hash copied')}>
                  <code>{short(txid, 18, 16)}</code>
                  <CopyIcon />
                </button>
              ) : (
                <code style={{ opacity: 0.4 }}>—</code>
              )}
            </div>
            <span className={`tx-status ${status.className}`}>
              <i className="tx-dot" /> {status.label}
            </span>
          </div>

          {/* ── No hash: lookup form ── */}
          {!txid && (
            <form className="tx-lookup" onSubmit={submitLookup}>
              <label className="tx-input-label" htmlFor="tx-hash">Transaction hash</label>
              <div className="tx-field">
                <input
                  id="tx-hash"
                  className="tx-input"
                  aria-describedby="tx-lookup-hint"
                  aria-invalid={Boolean(lookupError)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  enterKeyHint="go"
                  value={lookup}
                  onChange={(event) => { setLookup(event.target.value); setLookupError(''); }}
                  placeholder="Paste a transaction hash or explorer link"
                  aria-label="Litecoin transaction hash"
                  spellCheck="false"
                  autoComplete="off"
                />
                <button type="submit" className="tx-btn">Open receipt →</button>
              </div>
              <p id="tx-lookup-hint" aria-live="polite" className={`tx-hint${lookupError ? ' bad' : ''}`}>
                {lookupError || 'Find the transaction hash in your wallet’s transfer history. No wallet connection needed.'}
              </p>
            </form>
          )}

          {/* ── Error ── */}
          {txid && error && (
            <div className="tx-error">
              <span className="tx-error-mark">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" />
                  <path d="M12 16h.01" />
                </svg>
              </span>
              <strong>Couldn&apos;t load receipt.</strong>
              <p>{error} It may be too recent to have propagated, or the hash may belong to another chain.</p>
              <div className="tx-actions" style={{ border: 0, padding: '4px 0 0' }}>
                <a className="tx-btn" href={`${EXPLORER}${txid}`} target="_blank" rel="noreferrer">Try the explorer ↗</a>
                <a className="tx-btn ghost" href="/tx">Look up another</a>
              </div>
            </div>
          )}

          {/* ── Loading skeleton ── */}
          {txid && !tx && !error && (
            <div className="tx-skeleton">
              <div className="tx-bone tall w65" />
              <div className="tx-bone w40" />
              <div className="tx-bone" />
              <div className="tx-bone w65" />
              <div className="tx-bone w25" />
            </div>
          )}

          {/* ── Loaded ── */}
          {txid && tx && !error && (
            <>
              <div className="tx-hero">
                <div>
                  <span className="tx-label">TOTAL OUTPUT</span>
                  <strong className="tx-amount">
                    {animatedLtc.toFixed(8)}<b>LTC</b>
                  </strong>
                  <span className="tx-sub">
                    {price && <span className="tx-usd">≈ {formatUsd(animatedUsd)}</span>}
                    {price && ' · '}
                    network fee {formatLtc(tx.fees || 0)} LTC
                  </span>
                </div>
                <ConfirmationRing confirmations={confirmations} />
                <TxSigil txid={txid} />
              </div>

              <div className="tx-grid">
                <div>
                  <span className="tx-label">FROM</span>
                  <button type="button" className="tx-copyable" onClick={() => copy(parties.inputs[0]?.address || '', 'Address copied')}>
                    <code>{short(parties.inputs[0]?.address || 'Unknown', 15, 10)}</code>
                    <CopyIcon />
                  </button>
                </div>
                <div>
                  <span className="tx-label">TO</span>
                  <button type="button" className="tx-copyable" onClick={() => copy(parties.outputs[0]?.address || '', 'Address copied')}>
                    <code>{short(parties.outputs[0]?.address || 'Unknown', 15, 10)}</code>
                    <CopyIcon />
                  </button>
                </div>
                <div>
                  <span className="tx-label">BLOCK</span>
                  <span>{tx.block_height > 0 ? tx.block_height.toLocaleString() : 'Mempool'}</span>
                </div>
                <div>
                  <span className="tx-label">SIZE</span>
                  <span>{tx.size ? `${tx.size.toLocaleString()} bytes` : '—'}</span>
                </div>
                <div>
                  <span className="tx-label">FIRST SEEN</span>
                  <span>{tx.received ? new Date(tx.received).toLocaleString() : '—'}</span>
                </div>
                <div>
                  <span className="tx-label">CONFIRMED</span>
                  <span>{tx.confirmed ? new Date(tx.confirmed).toLocaleString() : 'Pending'}</span>
                </div>
              </div>

              <div className="tx-flow">
                <div className="tx-flow-head">
                  <span>INPUTS <b>{parties.inputs.length}</b></span>
                  <span>OUTPUTS <b>{parties.outputs.length}</b></span>
                </div>
                <FlowDiagram inputs={parties.inputs} outputs={parties.outputs} />
                <div className="tx-flow-values">
                  <span>{formatLtc(totals.input)} LTC</span>
                  <span>{formatLtc(totals.output)} LTC</span>
                </div>
              </div>

              <div className="tx-parties">
                <button
                  type="button"
                  className="tx-toggle"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <span>{expanded ? 'HIDE' : 'SHOW'} ALL {parties.inputs.length + parties.outputs.length} PARTIES</span>
                  <ChevronIcon />
                </button>

                {expanded && (
                  <div className="tx-party-list">
                    {[
                      ...parties.inputs.map((party) => ({ ...party, side: 'in' })),
                      ...parties.outputs.map((party) => ({ ...party, side: 'out' })),
                    ].map((party, index) => (
                      <div
                        key={`${party.side}-${party.address}-${index}`}
                        className={`tx-party ${party.side}`}
                        style={{ animationDelay: `${Math.min(index, 14) * 35}ms` }}
                      >
                        <code>{party.side === 'in' ? '↘ ' : '↗ '}{short(party.address, 18, 12)}</code>
                        <b>{toLtc(party.value).toFixed(8)} LTC</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="tx-actions">
                <button type="button" className="tx-btn" onClick={() => copy(window.location.href, 'Receipt link copied')}>
                  Copy receipt link
                </button>
                <button type="button" className="tx-btn ghost" onClick={() => copy(txid, 'Transaction hash copied')}>
                  Copy hash
                </button>
                <a className="tx-btn ghost" href={`${EXPLORER}${txid}`} target="_blank" rel="noreferrer">
                  Open explorer ↗
                </a>
                <a className="tx-btn ghost" href="/tx">Look up another</a>
              </div>
            </>
          )}
        </div>

      </section>

      {toast && (
        <div className="tx-toast" role="status">
          <CheckIcon /> {toast}
        </div>
      )}
    </main>
  );
}
