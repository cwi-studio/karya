// Karya Go — the draft, editable, one tap to create; and the "done" screen.
// SPDX-License-Identifier: AGPL-3.0-only
import { Boxes, CalendarDays, Check, ExternalLink, Flag, Plus, Search, Share2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import * as api from "./api";
import { AttachmentStrip } from "./Attach";
import type { Attachment } from "./attachments";
import { Avatar, PRIORITIES, Row, Sheet, Spinner, dueChoices, formatDue, priorityOf } from "./ui";

type Picker = "people" | "priority" | "due" | "module" | null;

export function Review(props: {
  slug: string;
  project: api.Project;
  ctx: api.Context;
  result: api.DraftResult;
  files: Attachment[];
  onAddFiles: () => void;
  onRemoveFile: (id: string) => void;
  onCancel: () => void;
  onCreated: (created: api.Created, draft: api.Draft) => void;
  onSignedOut: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<api.Draft>(props.result.draft);
  const [picker, setPicker] = useState<Picker>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<api.Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const members = props.project.members;
  const assignees = draft.assignee_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as api.Member[];
  const module = props.project.modules.find((m) => m.id === draft.module_id);
  const priority = priorityOf(draft.priority);

  const submit = async () => {
    if (!draft.title.trim()) return setError("Give it a title.");
    setSaving(true);
    setError("");
    try {
      props.onCreated(await api.create(props.slug, props.project, draft, props.result.transcript), draft);
    } catch (e) {
      if (e instanceof api.SignedOut) return props.onSignedOut(e);
      setError(e instanceof Error ? e.message : "Couldn't create the ticket.");
      setSaving(false);
    }
  };

  return (
    <div className="fade-in flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
        {!props.result.understood && (
          <p className="text-muted mb-3 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
            Karya couldn't fill everything in. Check the title and pick who it's for.
          </p>
        )}
        <div className="border-line bg-surface shadow-sm rounded-3xl border p-4">
          <label className="text-muted text-[11px] font-semibold tracking-wide uppercase" htmlFor="go-title">
            Ticket
          </label>
          <textarea
            id="go-title"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            rows={Math.min(4, Math.max(1, Math.ceil(draft.title.length / 30)))}
            className="mt-1 w-full resize-none bg-transparent text-[20px] leading-snug font-semibold outline-none"
          />
          <textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Add details (optional)"
            rows={Math.min(6, Math.max(2, Math.ceil(draft.description.length / 38)))}
            className="text-text/85 placeholder:text-muted/70 mt-2 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              onClick={() => setPicker("people")}
              empty={!assignees.length}
              icon={assignees.length ? null : <UserRound size={16} />}
            >
              {assignees.length ? (
                <span className="flex items-center gap-1.5">
                  <span className="flex -space-x-1.5">
                    {assignees.slice(0, 3).map((m) => (
                      <span key={m.id} className="ring-surface rounded-full ring-2">
                        <Avatar member={m} size={20} />
                      </span>
                    ))}
                  </span>
                  {assignees.length === 1 ? assignees[0].display_name : `${assignees.length} people`}
                </span>
              ) : (
                "Assign"
              )}
            </Chip>
            <Chip
              onClick={() => setPicker("priority")}
              empty={draft.priority === "none"}
              icon={
                <Flag
                  size={16}
                  style={{ color: priority.color }}
                  fill={draft.priority === "none" ? "none" : priority.color}
                />
              }
            >
              {draft.priority === "none" ? "Priority" : priority.label}
            </Chip>
            <Chip onClick={() => setPicker("due")} empty={!draft.target_date} icon={<CalendarDays size={16} />}>
              {draft.target_date ? formatDue(draft.target_date) : "Due date"}
            </Chip>
            {props.project.modules.length > 0 && (
              <Chip onClick={() => setPicker("module")} empty={!module} icon={<Boxes size={16} />}>
                {module ? module.name : "Module"}
              </Chip>
            )}
          </div>

          <div className="border-line mt-4 border-t pt-3">
            <AttachmentStrip items={props.files} onRemove={props.onRemoveFile} onAdd={props.onAddFiles} />
          </div>
        </div>

        {props.result.transcript && props.result.transcript !== draft.description && (
          <p className="text-muted mt-4 px-2 text-[13px] leading-relaxed">
            <span className="font-medium">You said:</span> “{props.result.transcript}”
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm mt-4 px-2 text-[#d13a2f] dark:text-[#ff8f80]">
            {error}
          </p>
        )}
      </div>

      <div className="flex gap-3 px-4 pt-2 pb-3">
        <button
          onClick={props.onCancel}
          disabled={saving}
          className="border-line text-muted rounded-full border px-5 py-3.5 font-medium active:bg-surface-2"
        >
          Redo
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="bg-coral text-ink flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 text-[16px] font-semibold shadow-[0_8px_24px_-8px_rgba(255,122,89,0.8)] active:scale-[0.98] disabled:opacity-70"
        >
          {saving ? <Spinner /> : <Check size={20} strokeWidth={2.6} />}
          {saving ? "Creating…" : "Create ticket"}
        </button>
      </div>

      {picker === "people" && (
        <PeoplePicker
          members={members}
          meId={props.ctx.me.id}
          selected={draft.assignee_ids}
          onChange={(ids) => set({ assignee_ids: ids })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "priority" && (
        <Sheet title="Priority" onClose={() => setPicker(null)}>
          {PRIORITIES.map((p) => (
            <Row
              key={p.value}
              selected={draft.priority === p.value}
              onClick={() => {
                set({ priority: p.value });
                setPicker(null);
              }}
            >
              <Flag size={18} style={{ color: p.color }} fill={p.value === "none" ? "none" : p.color} />
              {p.label}
            </Row>
          ))}
        </Sheet>
      )}
      {picker === "due" && (
        <Sheet title="Due date" onClose={() => setPicker(null)}>
          {dueChoices().map((c) => (
            <Row
              key={c.label}
              selected={draft.target_date === c.value}
              onClick={() => {
                set({ target_date: c.value });
                setPicker(null);
              }}
            >
              <span className="flex-1">{c.label}</span>
              <span className="text-sm text-muted">{formatDue(c.value)}</span>
            </Row>
          ))}
          <label className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]">
            <span className="flex-1">Pick a date</span>
            <input
              type="date"
              value={draft.target_date ?? ""}
              onChange={(e) => {
                set({ target_date: e.target.value || null });
                if (e.target.value) setPicker(null);
              }}
              className="rounded-lg bg-surface-2 px-2 py-1.5"
            />
          </label>
          {draft.target_date && (
            <Row
              onClick={() => {
                set({ target_date: null });
                setPicker(null);
              }}
            >
              <span className="text-muted">No due date</span>
            </Row>
          )}
        </Sheet>
      )}
      {picker === "module" && (
        <Sheet title="Module" onClose={() => setPicker(null)}>
          {props.project.modules.map((m) => (
            <Row
              key={m.id}
              selected={draft.module_id === m.id}
              onClick={() => {
                set({ module_id: m.id });
                setPicker(null);
              }}
            >
              <Boxes size={18} className="text-muted" />
              {m.name}
            </Row>
          ))}
          <Row
            onClick={() => {
              set({ module_id: null });
              setPicker(null);
            }}
          >
            <span className="text-muted">No module</span>
          </Row>
        </Sheet>
      )}
    </div>
  );
}

function Chip(props: { onClick: () => void; empty: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[14px] font-medium active:scale-95 ${
        props.empty ? "border-line text-muted border-dashed" : "border-line bg-surface-2"
      }`}
    >
      {props.empty ? <Plus size={15} /> : props.icon}
      {props.children}
    </button>
  );
}

function PeoplePicker(props: {
  members: api.Member[];
  meId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
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
      title="Who should do it?"
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
            <span
              className={`flex size-6 items-center justify-center rounded-full border-2 ${
                on ? "border-coral bg-coral text-ink" : "border-line"
              }`}
            >
              {on && <Check size={14} strokeWidth={3} />}
            </span>
          </Row>
        );
      })}
    </Sheet>
  );
}

const noun = (n: number) => (n === 1 ? "attachment" : "attachments");

export function Done(props: {
  project: api.Project;
  created: api.Created;
  draft: api.Draft;
  files: Attachment[];
  onRetry: (id: string) => void;
  onAnother: () => void;
}) {
  const total = props.files.length;
  const sent = props.files.filter((f) => f.status === "done").length;
  const failed = props.files.filter((f) => f.status === "failed");
  const uploadLine = !total
    ? ""
    : failed.length
      ? `${failed.length} ${noun(failed.length)} didn't upload. Tap to retry.`
      : sent === total
        ? `${total} ${noun(total)} added`
        : `Adding ${total} ${noun(total)}… keep the app open`;
  const names = props.draft.assignee_ids
    .map((id) => props.project.members.find((m) => m.id === id)?.display_name)
    .filter(Boolean);
  const facts = [
    names.length ? `Assigned to ${names.join(", ")}` : "Not assigned yet",
    props.draft.priority !== "none" ? priorityOf(props.draft.priority).label : "",
    props.draft.target_date ? `Due ${formatDue(props.draft.target_date)}` : "",
  ].filter(Boolean);
  const url = new URL(props.created.url, location.origin).toString();

  return (
    <div className="fade-in flex h-full flex-col items-center justify-center px-6">
      <div className="pop bg-coral text-ink flex size-24 items-center justify-center rounded-full">
        <Check size={52} strokeWidth={2.8} />
      </div>
      <p className="font-mono text-sm text-muted mt-6 font-medium">{props.created.key}</p>
      <h2 className="text-xl mt-1 max-w-sm text-center leading-snug font-semibold">{props.draft.title}</h2>
      <p className="text-muted mt-2 text-center text-[14px]">{facts.join(" · ")}</p>
      {total > 0 && (
        <div className="mt-5 flex w-full max-w-xs flex-col items-center">
          <AttachmentStrip items={props.files} onRetry={props.onRetry} />
          <p
            aria-live="polite"
            className={`mt-1 text-[13px] ${failed.length ? "text-[#d13a2f] dark:text-[#ff8f80]" : "text-muted"}`}
          >
            {uploadLine}
          </p>
        </div>
      )}

      <button
        onClick={props.onAnother}
        className="bg-coral text-ink mt-10 w-full max-w-xs rounded-full py-3.5 text-[16px] font-semibold"
      >
        New ticket
      </button>
      <div className="mt-3 flex gap-3">
        <a
          href={props.created.url}
          className="border-line text-sm flex items-center gap-1.5 rounded-full border px-4 py-2.5 font-medium active:bg-surface-2"
        >
          <ExternalLink size={16} /> Open
        </a>
        {"share" in navigator && (
          <button
            onClick={() =>
              navigator.share({ title: `${props.created.key} ${props.draft.title}`, url }).catch(() => undefined)
            }
            className="border-line text-sm flex items-center gap-1.5 rounded-full border px-4 py-2.5 font-medium active:bg-surface-2"
          >
            <Share2 size={16} /> Share
          </button>
        )}
      </div>
    </div>
  );
}
