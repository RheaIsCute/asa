# Crypto guide route

## What this is

`/crypto` (alias `/crypto-guide`) is a live, animated explainer of what happens
when a wallet address is looked up on a public blockchain. It is driven by the
Discord bot's `wbal <address>` command: every `wbal` reply links back here
with the address and detected chain as query params
(`?a=<address>&c=<btc|ltc|doge|dash|eth>`), and the page fetches its own fresh
balance/transaction data client-side for that exact address. There is no
hardcoded example transaction anywhere in the page — visiting it with a
different address (or no address at all, via the on-page lookup form) produces
a different, live result every time.

It has no API key, external service, or server-side component: it calls the
same keyless public endpoints the bot's own `src/coins.js#fetchBalance` uses
(`api.blockcypher.com/v1/<chain>/main/addrs/<address>`) plus CoinGecko for spot
price, both directly from the browser.

## Files changed

- `src/App.jsx` — lazy-loads `CryptoGuide` and routes `/crypto` and
  `/crypto-guide` to it (query string is read by the component, not the router).
- `src/CryptoGuide.jsx` — the whole page: a lookup form, a sticky four-step
  stepper (`address` → `ledger` → `activity` → `verify`), scroll-linked reveal
  animations per layer, an animated request/response pulse diagram for the
  balance check, count-up stat tiles, a live transaction list, and a glossary.
  Reuses `TxBackground.jsx` (ambient aurora/hex-rain canvas) and several
  utility classes from `tx.css` (`tx-dot`, `tx-copyable`, `tx-btn`, `tx-toast`,
  `tx-status`, `tx-input`, `tx-bone`) so this page and the `/tx` receipt page
  read as one visual system.
- `src/crypto-guide.css` — layout, the stepper, the ledger-pulse SVG animation,
  stat tiles, activity list, and an accordion glossary with a smooth
  grid-template-rows expand/collapse.

## What each layer shows

1. **The address** — the address that was looked up, chunked and revealed with
   a staggered animation, plus which chain it was detected/given as.
2. **Checking the ledger** — an animated two-way pulse (request out, response
   back) while the fetch is in flight, then three count-up stat tiles:
   confirmed balance, unconfirmed balance, and total received (each in the
   coin and in USD at the fetched spot price).
3. **Recent activity** — up to 5 real transaction hashes for that address,
   each linking to `asarii.xyz/tx/<hash>` (Litecoin) or a Blockchair explorer
   (everything else) — the same link logic `wbal` itself uses.
4. **Verify it yourself** — explains that a hash is just a receipt ID and
   links to a real record from the address just looked up, so the claim is
   independently checkable rather than asserted by the page.

A glossary (address, transaction hash, confirmed vs. unconfirmed, network fee,
block explorer) and a safety note about release-fee/verification-fee scams
close out the page.

## Supported chains

Limited to what BlockCypher's free `/addrs/` endpoint actually serves:
Bitcoin, Litecoin, Dogecoin, Dash, and Ethereum. This matches what `wbal`
already attempts server-side (via `guessCoin`) — an unsupported chain surfaces
as a lookup-failed state in both places rather than a silent wrong answer.

## Validation performed

- `npx.cmd eslint src/CryptoGuide.jsx` — clean.
- `npm.cmd run build` — clean.
- `vite preview` — `/crypto?a=<address>&c=ltc` returns HTTP 200 and serves the
  production bundle.

The repository-wide `npm run lint` still fails on pre-existing files
(`scratch_lyrics.js`, `src/Panel.jsx`, `src/scene.jsx`, `src/TransactionPage.jsx`)
unrelated to this route.

## Publishing

This repository is deployed through Vercel. If its GitHub-to-Vercel integration
is active, push these changes to the repository's production branch and Vercel
will deploy them. Otherwise, from this project directory, link the correct
Vercel project and run:

```powershell
vercel --prod
```

After deployment, `wbal <address>` in Discord links straight to the live guide
for that address at `https://asarii.xyz/crypto`.
