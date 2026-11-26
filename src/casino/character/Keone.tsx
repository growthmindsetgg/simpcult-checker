"use client";
/**
 * Keone: an original vinyl-toy caricature built entirely in code (see README).
 * Mount him directly under the scene root: ANCHORS are scene coordinates.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import type { CharacterHandle, Quality } from "../contract";
import { buildKeone } from "./build";
import { KeoneController } from "./controller";

export type KeoneProps = {
  ref?: Ref<CharacterHandle>;
  quality: Quality;
  /** dev only: receives the controller (lab time-scale and numeric checks) */
  onController?: (c: KeoneController | null) => void;
};

export function Keone({ ref, quality, onController }: KeoneProps) {
  const [ctl] = useState(() => new KeoneController());
  const rig = useMemo(() => {
    const r = buildKeone(quality);
    const cast = quality === "high";
    for (const m of r.shadowCasters) m.castShadow = cast;
    return r;
  }, [quality]);

  useEffect(() => {
    ctl.attach(rig);
    return () => ctl.attach(null);
  }, [ctl, rig]);

  // unmount (and StrictMode's rehearsal unmount): settle promises, kill tweens; the controller stays reusable
  useEffect(() => () => ctl.dispose(), [ctl]);

  useEffect(() => {
    onController?.(ctl);
    return () => onController?.(null);
  }, [ctl, onController]);

  useImperativeHandle(
    ref,
    () => ({
      get root() {
        return ctl.rig?.root ?? null;
      },
      walk: (path, opts) => ctl.walk(path, opts),
      sit: () => ctl.sit(),
      pullLever: () => ctl.pullLever(),
      react: (kind) => ctl.react(kind),
      snap: (state) => ctl.snap(state),
      glance: (hold) => ctl.glance(hold),
    }),
    [ctl],
  );

  useFrame((state, dt) => {
    ctl.camPos.copy(state.camera.position);
    ctl.update(dt);
  });

  return <primitive object={rig.root} />;
}
