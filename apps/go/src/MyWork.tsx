// Karya Go — open work items assigned to me; tap opens the full Karya.
// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarDays, Flag, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { Spinner, formatDue, priorityOf } from "./ui";

export function MyWork(props: { slug: string; onSignedOut: (e: unknown) => void }) {
  const [items, setItems] = useState<api.MyItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .mine(props.slug)
      .then(setItems)
      .catch((e) => (e instanceof api.SignedOut ? props.onSignedOut(e) : setError(e.message)))
      .finally(() => setLoading(false));
  }, [props]);

  useEffect(load, [props.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-1 pb-2">
        <h1 className="text-[22px] font-semibold">My work</h1>
        <button onClick={load} aria-label="Refresh" className="text-muted -mr-2 rounded-full p-2 active:bg-surface-2">
          {loading ? <Spinner className="size-[18px]" /> : <RefreshCw size={18} />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {error && <p className="text-muted px-2 py-6 text-center">{error}</p>}
        {!items && !error && (
          <div className="space-y-2 px-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-[68px] rounded-2xl" />
            ))}
          </div>
        )}
        {items && !items.length && (
          <p className="text-muted px-6 py-16 text-center">Nothing open is assigned to you. Enjoy it.</p>
        )}
        <ul className="space-y-2">
          {items?.map((item) => {
            const p = priorityOf(item.priority);
            const late = item.target_date && item.target_date < today;
            return (
              <li key={item.id}>
                <a
                  href={`/${props.slug}/browse/${item.key}/`}
                  className="border-line bg-surface flex gap-3 rounded-2xl border px-4 py-3 active:bg-surface-2"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ background: item.state.color || "#8b7d77" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[15px] leading-snug font-medium">{item.name}</span>
                    <span className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
                      <span className="font-mono">{item.key}</span>
                      <span>{item.state.name}</span>
                      {item.priority !== "none" && (
                        <span className="flex items-center gap-1">
                          <Flag size={12} style={{ color: p.color }} fill={p.color} />
                          {p.label}
                        </span>
                      )}
                      {item.target_date && (
                        <span
                          className={`flex items-center gap-1 ${late ? "font-medium text-[#d13a2f] dark:text-[#ff8f80]" : ""}`}
                        >
                          <CalendarDays size={12} />
                          {formatDue(item.target_date)}
                        </span>
                      )}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
