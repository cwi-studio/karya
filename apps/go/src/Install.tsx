// Karya Go — "Install app": Chrome's own install dialog on Android, Add to Home Screen steps on iPhone.
// SPDX-License-Identifier: AGPL-3.0-only
import { Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Mark, Sheet, storage } from "./ui";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Chrome fires this once, often before React mounts, so it is caught at import time.
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our button instead of Chrome's mini bar
    deferred = e as InstallPrompt;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    storage.set("installed", "1");
    listeners.forEach((fn) => fn());
  });
}

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const phone = () => ios() || /Android/.test(navigator.userAgent);

export function InstallBanner() {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(() => storage.get("install-dismissed") === "1");
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);

  if (standalone() || dismissed || storage.get("installed") === "1" || (!deferred && !phone())) return null;

  const install = async () => {
    if (!deferred) return setHelp(true);
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") storage.set("installed", "1");
    deferred = null;
    rerender((n) => n + 1);
  };

  return (
    <>
      <div className="fade-in border-line bg-surface shadow-sm mx-4 mb-1 flex items-center gap-3 rounded-2xl border py-2 pr-2 pl-3">
        <Mark size={28} />
        <p className="min-w-0 flex-1 text-[13px] leading-snug">
          <span className="font-semibold">Put Karya Go on your home screen</span>
          <span className="text-muted block">Opens like an app, stays signed in.</span>
        </p>
        <button
          onClick={install}
          className="bg-coral text-ink flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold"
        >
          <Download size={15} /> Install
        </button>
        <button
          onClick={() => {
            storage.set("install-dismissed", "1");
            setDismissed(true);
          }}
          aria-label="Not now"
          className="text-muted rounded-full p-1.5 active:bg-surface-2"
        >
          <X size={16} />
        </button>
      </div>
      {help && <InstallHelp onClose={() => setHelp(false)} />}
    </>
  );
}

function Step(props: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="bg-coral/15 text-coral-deep dark:text-coral text-sm flex size-7 shrink-0 items-center justify-center rounded-full font-semibold">
        {props.n}
      </span>
      <span className="pt-0.5 text-[15px] leading-relaxed">{props.children}</span>
    </li>
  );
}

const icon = (node: React.ReactNode) => (
  <span className="mx-0.5 inline-flex translate-y-1 items-center rounded-md bg-surface-2 px-1.5 py-0.5">{node}</span>
);

function InstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Install Karya Go" onClose={onClose}>
      {ios() ? (
        <ol className="px-2 pb-2">
          <Step n={1}>Open this page in Safari.</Step>
          <Step n={2}>
            Tap {icon(<Share size={16} />)} Share. On newer iPhones it's inside the {icon("•••")} button at the bottom.
          </Step>
          <Step n={3}>
            Scroll down and tap {icon(<SquarePlus size={16} />)} <b>Add to Home Screen</b>, then <b>Add</b>.
          </Step>
          <Step n={4}>Open Karya Go from your home screen and allow the microphone the first time.</Step>
        </ol>
      ) : (
        <ol className="px-2 pb-2">
          <Step n={1}>Open this page in Chrome (not inside WhatsApp or Gmail).</Step>
          <Step n={2}>Tap {icon("⋮")} at the top right.</Step>
          <Step n={3}>
            Tap <b>Install app</b> (or <b>Add to home screen</b> → <b>Install</b>).
          </Step>
          <Step n={4}>Open Karya Go from your home screen and allow the microphone the first time.</Step>
        </ol>
      )}
    </Sheet>
  );
}
