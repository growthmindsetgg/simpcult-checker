"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "./Icon";

/** tiny dep-free toast store: bottom-right cream slips, auto-dismiss */

export type ToastTone = "info" | "ok" | "bad" | "warn";
export type ToastItem = { id: number; tone: ToastTone; title: string; body?: string; ttl: number };

let seq = 1;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot() {
  return items;
}

const empty: ToastItem[] = [];
function serverSnapshot() {
  return empty;
}

export const toast = {
  show(t: Omit<ToastItem, "id">) {
    const id = seq++;
    const item = { ...t, id };
    items = [...items, item];
    emit();
    if (t.ttl > 0) setTimeout(() => toast.dismiss(id), t.ttl);
    return id;
  },
  info(title: string, body?: string, ttl = 4200) {
    return toast.show({ tone: "info", title, body, ttl });
  },
  ok(title: string, body?: string, ttl = 4200) {
    return toast.show({ tone: "ok", title, body, ttl });
  },
  bad(title: string, body?: string, ttl = 6000) {
    return toast.show({ tone: "bad", title, body, ttl });
  },
  warn(title: string, body?: string, ttl = 5000) {
    return toast.show({ tone: "warn", title, body, ttl });
  },
  dismiss(id: number) {
    items = items.filter((i) => i.id !== id);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};

const TONE_ICON: Record<ToastTone, "check" | "warn" | "close" | "shield"> = {
  ok: "check",
  warn: "warn",
  bad: "close",
  info: "shield",
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            data-tone={t.tone}
            role="status"
            initial={{ opacity: 0, y: 12, rotate: -1.2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, y: 10, transition: { duration: 0.16 } }}
            transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="toast-icon" aria-hidden>
              <Icon name={TONE_ICON[t.tone]} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button
              className="toast-close"
              aria-label="dismiss"
              onClick={() => toast.dismiss(t.id)}
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
