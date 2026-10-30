// Karya Go — edit a work item's description on the phone, without opening full Karya.
// SPDX-License-Identifier: AGPL-3.0-only
import { Bold, Heading, Italic, List, ListOrdered, Quote, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as api from "./api";
import { fromEditable, toEditable } from "./richtext";
import { Spinner } from "./ui";

type Tool = { cmd: string; label: string; icon: React.ReactNode; state?: () => boolean };
const block = () => (document.queryCommandValue("formatBlock") || "").toLowerCase();
const TOOLS: Tool[] = [
  { cmd: "bold", label: "Bold", icon: <Bold size={19} />, state: () => document.queryCommandState("bold") },
  { cmd: "italic", label: "Italic", icon: <Italic size={19} />, state: () => document.queryCommandState("italic") },
  { cmd: "heading", label: "Heading", icon: <Heading size={19} />, state: () => /^h[1-6]$/.test(block()) },
  {
    cmd: "insertUnorderedList",
    label: "Bulleted list",
    icon: <List size={20} />,
    state: () => document.queryCommandState("insertUnorderedList"),
  },
  {
    cmd: "insertOrderedList",
    label: "Numbered list",
    icon: <ListOrdered size={20} />,
    state: () => document.queryCommandState("insertOrderedList"),
  },
  { cmd: "quote", label: "Quote", icon: <Quote size={18} />, state: () => block() === "blockquote" },
];

export function DescriptionEditor(props: {
  itemKey: string;
  html: string;
  members: api.Member[];
  onSave: (html: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const start = useMemo(() => toEditable(props.html, props.members), []); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef<HTMLDivElement>(null);
  const original = useRef("");
  const leaving = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false); // "discard your changes?"
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<Record<string, boolean>>({});

  useLayoutEffect(() => {
    const el = box.current!;
    el.innerHTML = start.html;
    original.current = fromEditable(el, start.kept);
    // Cursor at the end: most edits on a phone add a line to what's there.
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }, [start]);

  // Back button / swipe-back: leave if nothing changed, otherwise stay and ask.
  const state = useRef({ dirty, onClose: props.onClose });
  state.current = { dirty, onClose: props.onClose };
  useEffect(() => {
    history.pushState({ goDescription: true }, "");
    const onPop = () => {
      if (leaving.current || !state.current.dirty) return state.current.onClose();
      history.pushState({ goDescription: true }, "");
      setAsking(true);
    };
    window.addEventListener("popstate", onPop);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onSelect = () => {
      if (!box.current?.contains(getSelection()?.anchorNode ?? null)) return;
      setActive(Object.fromEntries(TOOLS.map((t) => [t.cmd, t.state?.() ?? false])));
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, []);

  const current = () => fromEditable(box.current!, start.kept);
  const changed = () => setDirty(current() !== original.current);
  const leave = () => {
    leaving.current = true;
    history.back();
  };
  const cancel = () => (dirty ? setAsking(true) : leave());

  const run = (cmd: string) => {
    box.current?.focus({ preventScroll: true });
    if (cmd === "heading") document.execCommand("formatBlock", false, /^h[1-6]$/.test(block()) ? "p" : "h3");
    else if (cmd === "quote") document.execCommand("formatBlock", false, block() === "blockquote" ? "p" : "blockquote");
    else document.execCommand(cmd);
    setActive(Object.fromEntries(TOOLS.map((t) => [t.cmd, t.state?.() ?? false])));
    changed();
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await props.onSave(current());
    setSaving(false);
    if (ok) leave();
  };

  return (
    <div
      className="fade-in bg-bg fixed inset-0 z-40 mx-auto flex max-w-lg flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit description of ${props.itemKey}`}
    >
      <header className="safe-top border-line flex items-center gap-2 border-b px-2 pb-2">
        <button onClick={cancel} aria-label="Cancel" className="rounded-full p-2 active:bg-surface-2">
          <X size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] leading-tight font-semibold">Description</p>
          <p className="font-mono text-muted text-[12px]">{props.itemKey}</p>
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="bg-coral text-ink flex min-w-20 items-center justify-center rounded-full px-4 py-2 text-[15px] font-semibold disabled:opacity-40"
        >
          {saving ? <Spinner /> : "Save"}
        </button>
      </header>

      <div
        className="border-line flex gap-1 overflow-x-auto border-b px-2 py-1.5"
        role="toolbar"
        aria-label="Formatting"
      >
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            aria-label={t.label}
            aria-pressed={!!active[t.cmd]}
            // Keep the keyboard and the selection: a normal tap would blur the text first.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => run(t.cmd)}
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl active:bg-surface-2 ${
              active[t.cmd] ? "bg-coral/15 text-coral-deep dark:text-coral" : "text-muted"
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {asking && (
        <div className="border-line bg-surface flex items-center gap-2 border-b px-4 py-2.5" role="alert">
          <p className="flex-1 text-[14px] font-medium">Discard your changes?</p>
          <button onClick={() => setAsking(false)} className="rounded-full px-3 py-1.5 text-[14px] font-medium">
            Keep editing
          </button>
          <button
            onClick={leave}
            className="rounded-full bg-[#d13a2f] px-3 py-1.5 text-[14px] font-semibold text-white"
          >
            Discard
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-10">
        <div
          ref={box}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Description"
          data-placeholder="What needs doing, steps to reproduce, links…"
          onInput={changed}
          onPaste={(e) => {
            // Pasted web pages bring their own styles; take the words, Karya formats them.
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
          className="rich editor min-h-[50dvh] outline-none"
        />
      </div>
    </div>
  );
}
