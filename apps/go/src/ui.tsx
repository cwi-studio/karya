// Karya Go — small shared pieces.
// SPDX-License-Identifier: AGPL-3.0-only
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { Member, Priority } from "./api";

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: "urgent", label: "Urgent", color: "#e5484d" },
  { value: "high", label: "High", color: "#f76b15" },
  { value: "medium", label: "Medium", color: "#e2a336" },
  { value: "low", label: "Low", color: "#3e63dd" },
  { value: "none", label: "No priority", color: "#8b7d77" },
];
export const priorityOf = (p: Priority) => PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[4];

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Karya">
      <rect width="100" height="100" rx="22" fill="#1c0f0b" />
      <rect x="24" y="38" width="36" height="36" rx="9" stroke="#ff7a59" strokeWidth="5" opacity="0.5" />
      <path d="M33 56L42 65L67 37" stroke="#ff7a59" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="76" cy="27" r="5" fill="#ff7a59" />
    </svg>
  );
}

const HUES = [12, 28, 160, 200, 260, 320, 45, 100];
export function Avatar({ member, size = 28 }: { member: Pick<Member, "display_name" | "avatar_url">; size?: number }) {
  const name = member.display_name || "?";
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  if (member.avatar_url)
    return (
      <img
        src={member.avatar_url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 55% 48%)` }}
    >
      {name[0].toUpperCase()}
    </span>
  );
}

/** Bottom sheet: the thumb-friendly picker for every choice in the app. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
    >
      <button aria-label="Close" className="fade-in absolute inset-0 bg-black/45" onClick={props.onClose} />
      <div className="sheet-in safe-bottom bg-surface shadow-2xl relative flex max-h-[85dvh] flex-col rounded-t-3xl">
        <div className="bg-line mx-auto mt-2.5 h-1.5 w-10 rounded-full" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <h2 className="text-lg font-semibold">{props.title}</h2>
          <button
            onClick={props.onClose}
            aria-label="Close"
            className="text-muted -mr-2 rounded-full p-2 active:bg-surface-2"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{props.children}</div>
        {props.footer && <div className="border-line border-t px-4 pt-3">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Row(props: { onClick: () => void; selected?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.selected}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] active:bg-surface-2 ${
        props.selected ? "bg-coral/10 font-medium" : ""
      }`}
    >
      {props.children}
    </button>
  );
}

// Dates are local calendar dates (YYYY-MM-DD), the same thing Karya's due date holds.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};
export function dueChoices() {
  const today = new Date();
  const toFriday = (5 - today.getDay() + 7) % 7 || 7;
  const toMonday = (1 - today.getDay() + 7) % 7 || 7;
  return [
    { label: "Today", value: iso(today) },
    { label: "Tomorrow", value: iso(plus(1)) },
    { label: toFriday <= 1 ? "Next Friday" : "Friday", value: iso(plus(toFriday)) },
    { label: "Next Monday", value: iso(plus(toMonday)) },
  ];
}
export function formatDue(value: string | null) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const days = Math.round((date.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(`karya-go:${key}`) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`karya-go:${key}`, value);
    } catch {
      /* private mode: just don't remember */
    }
  },
};
