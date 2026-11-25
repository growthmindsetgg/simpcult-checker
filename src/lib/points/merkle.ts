import { encodeAbiParameters, keccak256, concat, type Hex } from "viem";

/**
 * Merkle tree matching contracts/src/SimpPoints.sol:
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, season, amount))))
 *   parent = keccak256(sorted(a, b))   — commutative, OpenZeppelin-style
 * Odd nodes are carried up unchanged. Proofs are bottom-up sibling lists.
 * Pure (no server-only) so it can be unit-checked anywhere.
 */

export function leafHash(account: Hex, season: bigint, amount: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [account.toLowerCase() as Hex, season, amount]),
  );
  return keccak256(inner);
}

function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export class MerkleTree {
  readonly layers: Hex[][];

  constructor(leaves: Hex[]) {
    if (leaves.length === 0) throw new Error("empty tree");
    const sorted = [...leaves].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0));
    this.layers = [sorted];
    while (this.layers[this.layers.length - 1].length > 1) {
      const cur = this.layers[this.layers.length - 1];
      const next: Hex[] = [];
      for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
      this.layers.push(next);
    }
  }

  get root(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  proof(leaf: Hex): Hex[] {
    let idx = this.layers[0].findIndex((l) => l.toLowerCase() === leaf.toLowerCase());
    if (idx < 0) throw new Error("leaf not in tree");
    const out: Hex[] = [];
    for (let d = 0; d < this.layers.length - 1; d++) {
      const layer = this.layers[d];
      const sib = idx ^ 1;
      if (sib < layer.length) out.push(layer[sib]);
      idx = Math.floor(idx / 2);
    }
    return out;
  }
}

export function verifyProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}
