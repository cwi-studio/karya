// Karya Go — the bottom-sheet pickers shared by the new ticket and the work item screens.
// SPDX-License-Identifier: AGPL-3.0-only
import { Check, Flag, Lock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type * as api from "./api";
import { Avatar, PRIORITIES, Row, Sheet, StateIcon, dueChoices, formatDue } from "./ui";

export function PeoplePicker(props: {
  title?: string;
  members: api.Member[];
  meId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
  noOne?: boolean; // offer "No one" (filters)
}) {
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => {
    const me = props.members.filter((m) => m.id === props.meId);
    return [...me, ...props.members.filter((m) => m.id !== props.meId)];
  }, [props.members, props.meId]);
  const q = query.trim().toLowerCase();
  const shown = sorted.filter(
    (m) => !q || m.display_name.toLowerCase().includes(q) || m.full_name.toLowerCase().includes(q)
  );
  const toggle = (id: string) =>
    props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);

  return (
    <Sheet
      title={props.title ?? "Who should do it?"}
      onClose={props.onClose}
      footer={
        <button onClick={props.onClose} className="bg-coral text-ink mb-1 w-full rounded-full py-3 font-semibold">
          Done
        </button>
      }
    >
      {props.members.length > 6 && (
        <label className="mx-1 mb-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
          <Search size={18} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      )}
      {props.noOne && !q && (
        <Row selected={props.selected.includes("none")} onClick={() => toggle("none")}>
          <span className="border-line flex size-[34px] items-center justify-center rounded-full border-2 border-dashed" />
          <span className="flex-1">No one</span>
          <Tick on={props.selected.includes("none")} />
        </Row>
      )}
      {shown.map((m) => {
        const on = props.selected.includes(m.id);
        return (
          <Row key={m.id} selected={on} onClick={() => toggle(m.id)}>
            <Avatar member={m} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {m.display_name}
                {m.id === props.meId && <span className="text-muted"> (me)</span>}
              </span>
              {m.full_name && m.full_name.toLowerCase() !== m.display_name.toLowerCase() && (
                <span className="text-xs text-muted block truncate">{m.full_name}</span>
              )}
            </span>
            <Tick on={on} />
          </Row>
        );
      })}
    </Sheet>
  );
}

export function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
        on ? "border-coral bg-coral text-ink" : "border-line"
      }`}
    >
      {on && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

export function PrioritySheet(props: { value: api.Priority; onPick: (p: api.Priority) => void; onClose: () => void }) {
  return (
    <Sheet title="Priority" onClose={props.onClose}>
      {PRIORITIES.map((p) => (
        <Row
          key={p.value}
          selected={props.value === p.value}
          onClick={() => {
            props.onPick(p.value);
            props.onClose();
          }}
        >
          <Flag size={18} style={{ color: p.color }} fill={p.value === "none" ? "none" : p.color} />
          {p.label}
        </Row>
      ))}
    </Sheet>
  );
}

export function DateSheet(props: {
  title: string;
  value: string | null;
  onPick: (value: string | null) => void;
  onClose: () => void;
}) {
  const pick = (value: string | null) => {
    props.onPick(value);
    props.onClose();
  };
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      {dueChoices().map((c) => (
        <Row key={c.label} selected={props.value === c.value} onClick={() => pick(c.value)}>
          <span className="flex-1">{c.label}</span>
          <span className="text-sm text-muted">{formatDue(c.value)}</span>
        </Row>
      ))}
      <label className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]">
        <span className="flex-1">Pick a date</span>
        <input
          type="date"
          value={props.value ?? ""}
          onChange={(e) => e.target.value && pick(e.target.value)}
          className="rounded-lg bg-surface-2 px-2 py-1.5"
        />
      </label>
      {props.value && (
        <Row onClick={() => pick(null)}>
          <span className="text-muted">No date</span>
        </Row>
      )}
    </Sheet>
  );
}

/** States of one project. A state with approvers I'm not one of is shown locked, with who can move items there. */
export function StateSheet(props: {
  states: api.State[];
  members: api.Member[];
  meId: string;
  value: string | null;
  onPick: (state: api.State) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Move to" onClose={props.onClose}>
      {props.states.map((s) => {
        const locked = s.id !== props.value && s.approver_ids.length > 0 && !s.approver_ids.includes(props.meId);
        const who = s.approver_ids
          .map((id) => props.members.find((m) => m.id === id)?.display_name)
          .filter(Boolean)
          .join(", ");
        return (
          <Row
            key={s.id}
            selected={s.id === props.value}
            onClick={() => {
              if (locked) return;
              props.onPick(s);
              props.onClose();
            }}
          >
            <span className={locked ? "opacity-45" : ""}>
              <StateIcon group={s.group} color={s.color} size={18} />
            </span>
            <span className={`min-w-0 flex-1 ${locked ? "text-muted" : ""}`}>
              <span className="block truncate">{s.name}</span>
              {locked && <span className="text-xs block truncate">Only {who || "approvers"} can move items here</span>}
            </span>
            {locked && <Lock size={16} className="text-muted" />}
            {s.id === props.value && <Check size={18} className="text-coral-deep dark:text-coral" />}
          </Row>
        );
      })}
    </Sheet>
  );
}

export function MultiSheet(props: {
  title: string;
  options: { id: string; name: string; color?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
  empty: string;
}) {
  const toggle = (id: string) =>
    props.onChange(props.selected.includes(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id]);
  return (
    <Sheet
      title={props.title}
      onClose={props.onClose}
      footer={
        <button onClick={props.onClose} className="bg-coral text-ink mb-1 w-full rounded-full py-3 font-semibold">
          Done
        </button>
      }
    >
      {!props.options.length && <p className="text-muted px-3 py-6 text-center">{props.empty}</p>}
      {props.options.map((o) => (
        <Row key={o.id} selected={props.selected.includes(o.id)} onClick={() => toggle(o.id)}>
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ background: o.color || "var(--muted)" }}
          />
          <span className="min-w-0 flex-1 truncate">{o.name}</span>
          <Tick on={props.selected.includes(o.id)} />
        </Row>
      ))}
    </Sheet>
  );
}
