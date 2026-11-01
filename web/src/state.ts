// Everything the page shows, read from the chain every few seconds.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { BRIDGED_SOL, Tiber, buyerAddress, poolAddress, titheState, twinAddress } from "./tiber";
import type { Reserves } from "./math";

export type TwinView = {
  mint: PublicKey;
  exists: boolean;
  openedAt: number;
  graduated: boolean;
  reserves: Reserves;
  supply: bigint;
  /** SOL waiting at the tithe to buy and burn this twin (paid by the sister's buys). */
  fund: bigint;
  /** Burned so far: by sells, by the tithe, and at graduation. */
  sellBurned: bigint;
  titheBurned: bigint;
  graduationBurned: bigint;
  titheSpent: bigint;
  buyTaxPaid: bigint;
};

export type Wallet = { sol: bigint; wrapped: bigint; rom: bigint; rem: bigint; hasWrapped: boolean; hasRom: boolean; hasRem: boolean };

const big = (v: any): bigint => BigInt(v?.toString?.() ?? "0");

async function readTwin(t: Tiber, mint: PublicKey): Promise<TwinView> {
  const c = t.connection;
  const [twinInfo, poolInfo, mintInfo, fund, stateInfo] = await Promise.all([
    c.getAccountInfo(twinAddress(mint), "confirmed"),
    c.getAccountInfo(poolAddress(mint), "confirmed"),
    c.getAccountInfo(mint, "confirmed"),
    t.balance(BRIDGED_SOL, buyerAddress(mint)),
    c.getAccountInfo(titheState(mint), "confirmed"),
  ]);
  const empty: Reserves = { base: 0n, quote: 0n, vBase: 0n, vQuote: 0n, curve: true };
  if (!twinInfo || !poolInfo || !mintInfo) {
    return { mint, exists: false, openedAt: 0, graduated: false, reserves: empty, supply: 0n, fund: 0n, sellBurned: 0n, titheBurned: 0n, graduationBurned: 0n, titheSpent: 0n, buyTaxPaid: 0n };
  }
  const twin: any = t.twins.coder.accounts.decode("twin", twinInfo.data);
  const pool: any = t.swap.coder.accounts.decode("pool", poolInfo.data);
  const m: any = t.token.coder.accounts.decode("mint", mintInfo.data);
  const st: any = stateInfo ? t.tithe.coder.accounts.decode("titheState", stateInfo.data) : null;
  return {
    mint,
    exists: true,
    openedAt: Number(big(twin.openedAt)),
    graduated: twin.graduated,
    reserves: {
      base: big(pool.baseReserve),
      quote: big(pool.quoteReserve),
      vBase: big(pool.virtualBase),
      vQuote: big(pool.virtualQuote),
      curve: pool.curve,
    },
    supply: big(m.supply),
    fund,
    sellBurned: big(twin.sellBurned),
    titheBurned: st ? big(st.burned) : 0n,
    graduationBurned: big(twin.graduationBurned),
    titheSpent: st ? big(st.spent) : 0n,
    buyTaxPaid: big(twin.buyTaxPaid),
  };
}

async function readWallet(t: Tiber, who: PublicKey, rom: PublicKey, rem: PublicKey): Promise<Wallet> {
  const c = t.connection;
  const [sol, w, r1, r2] = await Promise.all([
    c.getBalance(who, "confirmed"),
    c.getAccountInfo(holdingOf(BRIDGED_SOL, who), "confirmed"),
    c.getAccountInfo(holdingOf(rom, who), "confirmed"),
    c.getAccountInfo(holdingOf(rem, who), "confirmed"),
  ]);
  const amount = (i: any) => (i ? i.data.readBigUInt64LE(74) : 0n);
  return { sol: BigInt(sol), wrapped: amount(w), rom: amount(r1), rem: amount(r2), hasWrapped: !!w, hasRom: !!r1, hasRem: !!r2 };
}

import { holding as holdingOf } from "./tiber";

export function useChain(connection: Connection, rom: PublicKey, rem: PublicKey, who: PublicKey | null) {
  const tiber = useRef(new Tiber(connection)).current;
  const [twins, setTwins] = useState<[TwinView, TwinView] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([readTwin(tiber, rom), readTwin(tiber, rem)]);
      setTwins([a, b]);
      setWallet(who ? await readWallet(tiber, who, rom, rem) : null);
      setError(null);
    } catch (e: any) {
      setError(`Can't reach the network right now (${e?.message ?? e}).`);
    }
  }, [tiber, rom, rem, who]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 6000);
    const clock = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, [refresh]);

  return { tiber, twins, wallet, error, now, refresh };
}
