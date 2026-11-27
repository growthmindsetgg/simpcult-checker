"use client";
/**
 * Post chain. Bloom reads the linear HDR frame before tone mapping, so its
 * threshold is in scene units and exposure never moves it: it sits just above
 * the brightest non-emitter (measured with __casinoLab.hdr()), and only the
 * neon tube cores, the bulbs and the paylines (all drawn 2-3x over it) bloom.
 * Then Khronos PBR Neutral. AgX and Neutral were compared side by side on
 * the neon and the brass (?tm=agx in the lab): AgX greyed the hot pink and
 * flattened the brass toward olive; Neutral keeps authored colours (the
 * pink stays pink, the brass stays gold) and only rolls off the very top.
 *
 * high: bloom + Neutral + a light vignette + fine grain; 4x MSAA below DPR 2, SMAA at DPR 2
 *       (MSAA measured free against SMAA at 1440x900: 28.1/29.5 vs 29.0/28.6 fps)
 * mid:  bloom + Neutral + SMAA (the stage paints a CSS vignette instead)
 *
 * Tried on high and left out because they cost frames at 1440x900 on an integrated GPU (base
 * 29.0/28.6 fps): tinted N8AO (18.9/20.5) and a volumetric key-light cone (26.2/26.4).
 */
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { Quality } from "../contract";

/**
 * Linear luminance, measured with __casinoLab.hdr() at the rest frames (1440x900, high):
 * non-emitters p99.9 = 0.70 (hero) / 0.87 (play); only a few key-lit edge pixels (<0.05% of the
 * frame) reach 1.0-1.8. Emitters: the sign's tube cores 2.9, the topper neon ~2.4, lit arch
 * bulbs 1.3-2.4, paylines ~1.8.
 */
export const BLOOM_THRESHOLD = 1.1;

/** dev-only: ?tm=agx|aces compares tone mappers by eye in the lab */
function toneMapper(): ToneMappingMode {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    const tm = new URLSearchParams(window.location.search).get("tm");
    if (tm === "agx") return ToneMappingMode.AGX;
    if (tm === "aces") return ToneMappingMode.ACES_FILMIC;
  }
  return ToneMappingMode.NEUTRAL;
}

export function Post({ quality }: { quality: Exclude<Quality, "low"> }) {
  const mode = toneMapper();
  if (quality === "mid") {
    return (
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={BLOOM_THRESHOLD} luminanceSmoothing={0.15} intensity={0.75} radius={0.62} levels={6} />
        <ToneMapping mode={mode} />
        <SMAA />
      </EffectComposer>
    );
  }
  return <HighPost mode={mode} />;
}

function HighPost({ mode }: { mode: ToneMappingMode }) {
  // MSAA resolves geometry edges (brass rims, the cabinet's silhouette) better than SMAA; at DPR 2
  // the edges are already fine and 4x samples would cost four times the pixels, so SMAA there
  const msaa = useThree((s) => s.viewport.dpr) < 2;
  return (
    <EffectComposer multisampling={msaa ? 4 : 0}>
      <Bloom mipmapBlur luminanceThreshold={BLOOM_THRESHOLD} luminanceSmoothing={0.15} intensity={0.8} radius={0.62} levels={7} />
      <ToneMapping mode={mode} />
      <Vignette offset={0.3} darkness={0.45} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.12} />
      {msaa ? <></> : <SMAA />}
    </EffectComposer>
  );
}
