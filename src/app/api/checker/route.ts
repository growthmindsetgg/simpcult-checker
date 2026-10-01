import { NextResponse } from "next/server";
import { isAddress } from "viem";
import whitelist from "../../../../data/whitelist.json";

type Entry = { gtd?: boolean; fcfs?: boolean };
const WL = whitelist as Record<string, Entry>;

/** Whitelist lookup — the 1.7MB list stays on the server instead of shipping to every visitor. */
export async function POST(req: Request) {
  const { address } = ((await req.json().catch(() => ({}))) as { address?: string }) ?? {};
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "enter a valid wallet address" }, { status: 400 });
  }
  const e = WL[address.toLowerCase()];
  const gtd = !!e?.gtd;
  const fcfs = !!e?.fcfs;
  return NextResponse.json({ eligible: gtd || fcfs, gtd, fcfs, gtdMints: gtd ? 2 : 0, fcfsMints: fcfs ? 1 : 0 });
}
