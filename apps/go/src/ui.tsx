// Karya Go — small shared pieces.
// SPDX-License-Identifier: AGPL-3.0-only
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Member, Priority, StateGroup } from "./api";

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: "urgent", label: "Urgent", color: "#e5484d" },
  { value: "high", label: "High", color: "#f76b15" },
  { value: "medium", label: "Medium", color: "#e2a336" },
  { value: "low", label: "Low", color: "#3e63dd" },
  { value: "none", label: "No priority", color: "#8b7d77" },
];
export const priorityOf = (p: Priority) => PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[4];

export const GROUPS: { value: StateGroup; label: string; color: string }[] = [
  { value: "backlog", label: "Backlog", color: "#a3a3a3" },
  { value: "unstarted", label: "Todo", color: "#8b7d77" },
  { value: "started", label: "In progress", color: "#f59e0b" },
  { value: "completed", label: "Done", color: "#16a34a" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626" },
];
export const OPEN_GROUPS: StateGroup[] = ["backlog", "unstarted", "started"];
export const groupOf = (g: StateGroup) => GROUPS.find((x) => x.value === g) ?? GROUPS[0];

/** The same shapes full Karya uses: dashed ring, ring, half-filled, check, cross. */
export function StateIcon({ group, color, size = 14 }: { group: StateGroup; color: string; size?: number }) {
  const c = color || groupOf(group).color;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {group === "backlog" && (
        <circle cx="8" cy="8" r="6.5" fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="2.6 2" />
      )}
      {group === "unstarted" && <circle cx="8" cy="8" r="6.5" fill="none" stroke={c} strokeWidth="1.6" />}
      {group === "started" && (
        <>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke={c} strokeWidth="1.6" />
          <path d="M8 3.5A4.5 4.5 0 0 1 8 12.5Z" fill={c} />
        </>
      )}
      {group === "completed" && (
        <>
          <circle cx="8" cy="8" r="7.2" fill={c} />
          <path
            d="M5 8.2l2 2 4-4.2"
            fill="none"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {group === "cancelled" && (
        <>
          <circle cx="8" cy="8" r="7.2" fill={c} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

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

export function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** One message at a time, bottom of the screen, gone after a few seconds. */
export function useToast() {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, error = false) => {
    window.clearTimeout(timer.current);
    setMessage({ text, error });
    timer.current = window.setTimeout(() => setMessage(null), error ? 5000 : 2200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const element = message && (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6" aria-live="polite">
      <p
        role={message.error ? "alert" : "status"}
        className={`fade-in shadow-xl max-w-sm rounded-2xl px-4 py-2.5 text-[14px] font-medium ${
          message.error ? "bg-[#d13a2f] text-white" : "bg-ink dark:text-ink text-white dark:bg-[#f6eee9]"
        }`}
      >
        {message.text}
      </p>
    </div>
  );
  return { show, element };
}

const BLOCKS = new Set(["P", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "BR"]);
const INLINE = new Set(["STRONG", "B", "EM", "I", "U", "S", "CODE", "SPAN", "A", "MARK", "SUB", "SUP"]);

/** Descriptions and comments are rich text from full Karya. Keep the formatting tags, drop everything else
 * (scripts, styles, event handlers); mentions become @name and embedded images a note to open full Karya. */
export function safeHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.createElement("div");
  const walk = (from: Node, to: Node) => {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return to.appendChild(document.createTextNode(node.textContent ?? ""));
      if (!(node instanceof Element)) return;
      const tag = node.tagName;
      if (tag === "MENTION-COMPONENT") {
        const span = document.createElement("span");
        span.className = "mention";
        span.textContent = `@${node.getAttribute("entity_name") === "user_mention" ? node.textContent || "someone" : "someone"}`;
        return to.appendChild(span);
      }
      if (tag === "IMAGE-COMPONENT" || tag === "IMG") {
        const note = document.createElement("p");
        note.className = "image-note";
        note.textContent = "🖼 Image: open in full Karya to see it";
        return to.appendChild(note);
      }
      if (BLOCKS.has(tag) || INLINE.has(tag)) {
        const copy = document.createElement(tag === "A" ? "a" : tag.toLowerCase());
        if (tag === "A") {
          const href = node.getAttribute("href") ?? "";
          if (/^(https?:|mailto:|\/)/i.test(href)) copy.setAttribute("href", href);
          copy.setAttribute("target", "_blank");
          copy.setAttribute("rel", "noopener noreferrer");
        }
        walk(node, copy);
        return to.appendChild(copy);
      }
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE"].includes(tag)) return;
      walk(node, to); // unknown wrapper (div, table, task list…): keep its text and allowed children
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}
