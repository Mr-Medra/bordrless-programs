import { useMemo, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { CLUSTER, IS_TEST, REM, ROM, explorer } from "./config";
import {
  GRADUATION_QUOTE,
  HOLD_CAP,
  MAX_BUY,
  ONE,
  SOL,
  SUPPLY,
  buyTaxBps,
  fmtSol,
  fmtTok,
  parseAmount,
  priceLamports,
  quoteBuy,
  quoteSell,
} from "./math";
import { useChain, type TwinView, type Wallet } from "./state";
import { BRIDGED_SOL, type Tiber } from "./tiber";
import romArt from "./art/rom.svg?raw";
import remArt from "./art/rem.svg?raw";
import wolfArt from "./art/wolf.svg?raw";
import flameArt from "./art/flame.svg?raw";
import bannerArt from "./art/banner.svg?raw";

const Art = ({ svg, className }: { svg: string; className?: string }) => (
  <span className={`art ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: svg }} />
);

type Side = "rom" | "rem";
const NAMES: Record<Side, { name: string; ticker: string; hill: string }> = {
  rom: { name: "Romulus", ticker: "ROM", hill: "the Palatine" },
  rem: { name: "Remus", ticker: "REM", hill: "the Aventine" },
};

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { tiber, twins, wallet: mine, error, now, refresh } = useChain(connection, ROM, REM, wallet.publicKey);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);

  /** Signs and sends `ixs` with the connected wallet, then refreshes. */
  async function send(label: string, build: () => Promise<TransactionInstruction[]>, done: string) {
    if (!wallet.publicKey) return;
    setBusy(true);
    setNotice(null);
    try {
      const tx = await tiber.transaction(wallet.publicKey, await build());
      const sig = await wallet.sendTransaction(tx, connection);
      setNotice({ kind: "ok", text: <>{label}: sent, waiting for the network…</> });
      const res = await connection.confirmTransaction(sig, "confirmed");
      if (res.value.err) throw new Error(JSON.stringify(res.value.err));
      setNotice({
        kind: "ok",
        text: (
          <>
            {done}{" "}
            <a href={`https://explorer.solana.com/tx/${sig}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">
              View the transaction
            </a>
          </>
        ),
      });
      await refresh();
    } catch (e: any) {
      setNotice({ kind: "err", text: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  const [rom, rem] = twins ?? [null, null];
  // For the automated tests on a local network only: which test wallet is connected.
  if (CLUSTER === "local") (window as any).__tiberWallet = wallet.publicKey?.toBase58() ?? null;
  const ready = !!rom?.exists && !!rem?.exists;

  return (
    <>
      <header className="top">
        <a className="brand" href="#">
          <Art svg={wolfArt} className="brand-wolf" />
          <span>The Twins of the Tiber</span>
        </a>
        {IS_TEST && <span className="testnet">{CLUSTER === "local" ? "Local test network" : "Devnet"}: test SOL only, nothing here has value</span>}
        <WalletMultiButton />
      </header>

      <section className="hero">
        <div className="hero-words">
          <h1>Two hills. Two cities. One wolf.</h1>
          <p>Romulus (ROM) and Remus (REM) are twin tokens on Solana. Every buy of one buys and burns the other. Every sell burns itself.</p>
          <p className="choose">Choose your brother.</p>
        </div>
        <Art svg={bannerArt} className="hero-art" />
      </section>

      {error && <p className="banner-msg err">{error}</p>}
      {notice && (
        <p className={`banner-msg ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}

      <main className="hills" id="trade">
        {!twins && <p className="loading">Reading the chain…</p>}
        {twins && !ready && <p className="loading">The twins aren't set up on this network yet.</p>}
        {rom && rem && ready && (
          <>
            <TwinColumn side="rom" twin={rom} sister={rem} mine={mine} now={now} busy={busy} tiber={tiber} send={send} who={wallet.publicKey} />
            <River rom={rom} rem={rem} now={now} busy={busy} tiber={tiber} send={send} who={wallet.publicKey} />
            <TwinColumn side="rem" twin={rem} sister={rom} mine={mine} now={now} busy={busy} tiber={tiber} send={send} who={wallet.publicKey} />
          </>
        )}
      </main>

      <Oath />
      <Lore />

      <footer className="foot">
        <p>No presale, no insider buys, 20% treasury reserve, 75% of it locked for 6 months by code.</p>
        <p className="addresses">
          <a href={explorer(ROM.toBase58())} target="_blank" rel="noreferrer">ROM on the explorer</a>
          <a href={explorer(REM.toBase58())} target="_blank" rel="noreferrer">REM on the explorer</a>
          <a href="https://github.com/Mr-Medra/tiber" target="_blank" rel="noreferrer">Source code</a>
        </p>
      </footer>
    </>
  );
}

type Send = (label: string, build: () => Promise<TransactionInstruction[]>, done: string) => Promise<void>;

function TwinColumn(p: {
  side: Side;
  twin: TwinView;
  sister: TwinView;
  mine: Wallet | null;
  now: number;
  busy: boolean;
  tiber: Tiber;
  send: Send;
  who: PublicKey | null;
}) {
  const { side, twin } = p;
  const n = NAMES[side];
  const r = twin.reserves;
  const price = priceLamports(r);
  const value = (price * Number(twin.supply)) / Number(ONE);
  const raised = r.curve ? r.quote : GRADUATION_QUOTE;
  const progress = Math.min(1, Number(raised) / Number(GRADUATION_QUOTE));
  const burned = SUPPLY - twin.supply;
  const held = p.mine ? (side === "rom" ? p.mine.rom : p.mine.rem) : null;

  return (
    <article className={`twin twin-${side}`} aria-labelledby={`${side}-name`}>
      <Art svg={side === "rom" ? romArt : remArt} className="coin" />
      <h2 id={`${side}-name`}>
        {n.name} <span className="ticker">{n.ticker}</span>
      </h2>
      <dl className="facts">
        <div>
          <dt>Price of 1,000,000 {n.ticker}</dt>
          <dd>{(price * 1e6 / 1e9).toPrecision(3)} SOL</dd>
        </div>
        <div>
          <dt>Whole twin valued at</dt>
          <dd>{(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })} SOL</dd>
        </div>
        <div>
          <dt>Burned for ever</dt>
          <dd>{fmtTok(burned)} {n.ticker}</dd>
        </div>
        {held !== null && (
          <div>
            <dt>You hold</dt>
            <dd>{fmtTok(held)} {n.ticker}</dd>
          </div>
        )}
      </dl>

      <div className="curve" aria-label={`${n.name}'s curve`}>
        {twin.graduated ? (
          <p>Graduated: trading in its own pool, with the liquidity locked for good.</p>
        ) : (
          <>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={30} aria-valuenow={Number(fmtSol(raised, 2))}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <p>
              {fmtSol(raised, 2)} of 30 SOL raised on the curve. At 30 SOL it graduates into a pool whose liquidity no one can pull.
            </p>
          </>
        )}
      </div>

      <TradeBox {...p} />
    </article>
  );
}

function TradeBox(p: { side: Side; twin: TwinView; sister: TwinView; mine: Wallet | null; now: number; busy: boolean; tiber: Tiber; send: Send; who: PublicKey | null }) {
  const { side, twin, sister, mine, now, tiber, who } = p;
  const n = NAMES[side];
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("");
  const open = twin.openedAt > 0 && now >= twin.openedAt;
  const taxBps = buyTaxBps(now, twin.openedAt);
  const held = mine ? (side === "rom" ? mine.rom : mine.rem) : 0n;

  const amount = parseAmount(text, mode === "buy" ? 9 : 6);
  const check = useMemo(() => {
    if (!amount || amount === 0n) return null;
    if (mode === "buy") {
      const q = quoteBuy(twin.reserves, amount, taxBps);
      let problem: string | null = null;
      if (q.out > MAX_BUY) problem = `One buy can take at most 10,000,000 ${n.ticker} (1% of the supply). Try a smaller amount.`;
      else if (held + q.out > HOLD_CAP) problem = `No wallet may hold more than 15,000,000 ${n.ticker} (1.5%). You hold ${fmtTok(held)}, so you can buy about ${fmtTok(HOLD_CAP - held)} more.`;
      else if (mine && amount + 10_000_000n > mine.sol + mine.wrapped) problem = "You don't have that much SOL (keep a little for the network fee).";
      return {
        lines: [
          [`You get about`, `${fmtTok(q.out)} ${n.ticker}`],
          [`Tax to buy and burn ${NAMES[side === "rom" ? "rem" : "rom"].ticker}`, `${fmtSol(q.tax)} SOL (${Number(taxBps) / 100}%)`],
        ],
        problem,
        minOut: (q.out * 98n) / 100n,
        soldOut: q.soldOut,
      };
    }
    const q = quoteSell(twin.reserves, amount);
    let problem: string | null = null;
    if (amount > held) problem = `You hold ${fmtTok(held)} ${n.ticker}.`;
    return {
      lines: [
        [`You get about`, `${fmtSol(q.out)} SOL`],
        [`Burned in Vesta's flame`, `${fmtTok(q.burn)} ${n.ticker} (2%)`],
      ],
      problem,
      minOut: (q.out * 98n) / 100n,
      soldOut: false,
    };
  }, [amount, mode, twin.reserves, taxBps, held, mine, n.ticker, side]);

  async function go() {
    if (!who || !amount || !check || check.problem || !mine) return;
    const mint = twin.mint;
    const sisterMint = sister.mint;
    if (mode === "buy") {
      await p.send(
        `Buy ${n.ticker}`,
        async () => {
          const ixs: TransactionInstruction[] = [];
          if (!mine.hasWrapped) ixs.push(await tiber.createHolding(who, BRIDGED_SOL, who));
          if (!(side === "rom" ? mine.hasRom : mine.hasRem)) ixs.push(await tiber.createHolding(who, mint, who));
          const need = amount > mine.wrapped ? amount - mine.wrapped : 0n;
          if (need > 0n) ixs.push(await tiber.wrapSol(who, need));
          // Anything a sold-out curve does not use stays wrapped and goes into the next buy.
          ixs.push(await tiber.swapIx(who, mint, sisterMint, 1, amount, check.minOut));
          return ixs;
        },
        `Bought ${n.ticker}.`,
      );
    } else {
      await p.send(
        `Sell ${n.ticker}`,
        async () => {
          const ixs: TransactionInstruction[] = [];
          if (!mine.hasWrapped) ixs.push(await tiber.createHolding(who, BRIDGED_SOL, who));
          ixs.push(await tiber.swapIx(who, mint, sisterMint, 0, amount, check.minOut));
          ixs.push(await tiber.unwrapSolAbove(who, mine.wrapped));
          return ixs;
        },
        `Sold ${n.ticker}.`,
      );
    }
    setText("");
  }

  return (
    <div className="trade">
      <div className="modes" role="tablist" aria-label={`Buy or sell ${n.ticker}`}>
        <button role="tab" aria-selected={mode === "buy"} onClick={() => { setMode("buy"); setText(""); }}>
          Buy
        </button>
        <button role="tab" aria-selected={mode === "sell"} onClick={() => { setMode("sell"); setText(""); }}>
          Sell
        </button>
      </div>
      <label className="amount">
        <span>{mode === "buy" ? "SOL to spend" : `${n.ticker} to sell`}</span>
        <input inputMode="decimal" placeholder={mode === "buy" ? "0.1" : "1000000"} value={text} onChange={(e) => setText(e.target.value)} />
        {mode === "sell" && held > 0n && (
          <button className="max" type="button" onClick={() => setText((Number(held) / 1e6).toString())}>
            All
          </button>
        )}
      </label>
      {check && (
        <dl className="quote">
          {check.lines.map(([a, b]) => (
            <div key={a}>
              <dt>{a}</dt>
              <dd>{b}</dd>
            </div>
          ))}
          {check.soldOut && <p>This buy takes the last of the curve; what it doesn't need stays with you.</p>}
        </dl>
      )}
      {check?.problem && <p className="problem">{check.problem}</p>}
      {mode === "buy" && open && taxBps > 200n && <p className="problem">Anti-sniper fee: the buy tax is {Number(taxBps) / 100}% for the first 30 seconds after opening, falling to 2%.</p>}
      {!open && <p className="problem">Trading hasn't opened yet.</p>}
      <button className="act" disabled={!who || !open || !check || !!check.problem || p.busy} onClick={go}>
        {!who ? "Connect a wallet to trade" : mode === "buy" ? `Buy ${n.ticker}` : `Sell ${n.ticker}`}
      </button>
    </div>
  );
}

function River(p: { rom: TwinView; rem: TwinView; now: number; busy: boolean; tiber: Tiber; send: Send; who: PublicKey | null }) {
  const { rom, rem, tiber, who } = p;
  const flows: [TwinView, TwinView, Side][] = [
    [rem, rom, "rem"],
    [rom, rem, "rom"],
  ];
  return (
    <aside className="river" aria-label="The tithe between the twins">
      <Art svg={flameArt} className="flame" />
      <h2>The tithe</h2>
      <p>Each buy of one twin pays 2% of its SOL into a fund that buys the other twin and burns it in Vesta's flame. Anyone may set the tithe going.</p>
      {flows.map(([target, payer, side]) => {
        const n = NAMES[side];
        const burned = target.titheBurned;
        const graduating = target.reserves.curve && target.reserves.base === 0n;
        return (
          <div className="flow" key={side}>
            <p className="flow-head">
              {NAMES[side === "rom" ? "rem" : "rom"].ticker} buys feed {n.ticker}
            </p>
            <p className="flow-fund">{fmtSol(target.fund)} SOL waiting</p>
            <p className="flow-sub">{fmtTok(burned)} {n.ticker} bought and burned so far</p>
            {graduating ? (
              <button className="act small" disabled={!who || p.busy} onClick={() => p.send(`Graduate ${n.ticker}`, async () => [await tiber.graduateIx(who!, target.mint)], `${n.name} graduated.`)}>
                Graduate {n.name}
              </button>
            ) : (
              <button
                className="act small"
                disabled={!who || p.busy || target.fund === 0n || target.openedAt === 0}
                onClick={() => p.send(`Tithe ${n.ticker}`, async () => [await tiber.titheIx(who!, target.mint, payer.mint)], `The tithe bought and burned ${n.ticker}.`)}
              >
                Burn {n.ticker} with the tithe
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function Oath() {
  const rules: [string, string][] = [
    ["The tithe", "Every buy pays 2% of its SOL toward buying the sister twin, which is burned as soon as it is bought."],
    ["Vesta's flame", "Every sell burns 2% of the tokens sold. Supply only ever shrinks."],
    ["The wall", "No wallet may hold more than 15,000,000 of a twin (1.5%), and one buy can take at most 10,000,000 (1%). Only ordinary wallets can hold a twin, so every trade goes through the taxed pools."],
    ["The first thirty seconds", "The buy tax starts at 80% when trading opens and falls to 2% over 30 seconds, so bots gain nothing by being first. What they pay feeds the sister's tithe."],
    ["The treasury", "20% of each twin. 150,000,000 are locked by code for six months after trading opens. At most 1,000,000 can leave the treasury on any day."],
    ["The curve", "Each twin starts on a bonding curve. At 30 SOL raised it graduates into a pool, and its liquidity is locked for good: nobody, the founder included, can pull it."],
    ["Written in stone", "No one can mint more, freeze a holder, or change these rules. The programs enforce them, not a person."],
  ];
  return (
    <section className="oath" aria-labelledby="oath-title">
      <h2 id="oath-title">The Oath of the Wolf</h2>
      <dl>
        {rules.map(([a, b]) => (
          <div key={a}>
            <dt>{a}</dt>
            <dd>{b}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Lore() {
  return (
    <section className="lore" aria-labelledby="lore-title">
      <h2 id="lore-title">The Twins of the Tiber</h2>
      <p>Before there was a Rome, there were two boys in a basket on the river.</p>
      <p>
        Their mother, Rhea Silvia, was a priestess of Vesta, keeper of the sacred flame. Their father was Mars, god of war. A jealous king, Amulius, feared what the twins would become, and ordered them drowned in the Tiber. But the river would not take them. It carried the basket gently ashore, beneath a fig tree, below the Palatine hill.
      </p>
      <p>There a she-wolf found them. She did not tear them apart. She fed them, one at each side, and the brothers learned their first law before they could speak: there is enough when you share it.</p>
      <p>
        They grew up shepherds, then warriors, then founders. When the time came to build a city, they argued over the hill. Remus watched from the Aventine and saw six vultures. Romulus watched from the Palatine and saw twelve. In the old telling, the quarrel ended in blood at the city wall.
      </p>
      <p className="turn">Not in this one.</p>
      <p>In this telling, the wolf returned. She stood on the half-built wall between them and gave them a choice: two cities that starve each other, or two cities that feed each other. The brothers swore the Oath of the Wolf.</p>
      <p>
        Whatever is spent in Romulus's city, a tithe goes to Remus. Whatever is spent in Remus's city, a tithe goes to Romulus. And whoever walks away from either city leaves an offering to their mother's flame, so that each city grows smaller in number and dearer in worth.
      </p>
      <p>The oath is written into the stone. No king, priest or founder can change it, not even the twins themselves.</p>
    </section>
  );
}

/** A plain-language reason for a failed transaction. */
function explain(e: any): string {
  const text = `${e?.message ?? e} ${(e?.logs ?? e?.transactionLogs ?? []).join(" ")}`;
  const code = text.match(/Error Code: (\w+)/)?.[1];
  const known: Record<string, string> = {
    OverTheWall: "That would put the wallet over 1.5% of the supply.",
    WalletsOnly: "Only ordinary wallets can hold a twin.",
    BuyTooLarge: "One buy can take at most 1% of the supply.",
    NotOpen: "Trading hasn't opened yet.",
    OncePerSlot: "The tithe just ran; try again in a moment.",
    NothingToSpend: "The tithe fund is empty right now.",
    Slippage: "The price moved before your trade landed. Try again.",
  };
  if (code && known[code]) return known[code];
  if (/User rejected|rejected the request/i.test(text)) return "You cancelled it in your wallet.";
  if (/insufficient|0x1\b/i.test(text)) return "Not enough SOL for that and the network fee.";
  return `It didn't go through: ${code ?? (e?.message ?? String(e)).slice(0, 160)}`;
}
