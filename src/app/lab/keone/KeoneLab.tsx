"use client";
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const KeoneLabScene = dynamic(() => import("./KeoneLabScene"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, color: "#f1e4cc" }}>loading keone…</p>,
});

const noop = () => () => {};

export function KeoneLab() {
  // portal to <body>: the page wrapper's enter transform would otherwise trap position:fixed
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const lab = (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "#0a0610" }}>
      <KeoneLabScene />
    </div>
  );
  return mounted ? createPortal(lab, document.body) : lab;
}
