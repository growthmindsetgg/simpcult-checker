"use client";
/**
 * Post chain. Bloom sees HDR values (threshold 0.9 so only neon and the lit
 * reel glass bloom), then ACES. High adds vignette, film grain and SMAA; mid
 * is bloom + tone mapping only (the stage paints a CSS vignette instead).
 */
import { Bloom, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import type { Quality } from "../contract";

export function Post({ quality }: { quality: Exclude<Quality, "low"> }) {
  if (quality === "mid") {
    return (
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.12} intensity={0.85} radius={0.7} levels={6} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.12} intensity={0.95} radius={0.72} levels={7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.32} />
      <SMAA />
    </EffectComposer>
  );
}
