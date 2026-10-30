// Karya Go — one work item: change its state and properties, read the description, comment, attach.
// Every change is shown at once and undone if Karya refuses it (an approver-only state, a lost connection).
// SPDX-License-Identifier: AGPL-3.0-only
import {
  Boxes,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ExternalLink,
  FileText,
  Flag,
  Paperclip,
  Pencil,
  Send,
  Share2,
  Tag,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { useFilePicker } from "./Attach";
import { DescriptionEditor } from "./DescriptionEditor";
import { upload } from "./attachments";
import { DateSheet, MultiSheet, PeoplePicker, PrioritySheet, StateSheet } from "./pickers";
import { Avatar, Spinner, StateIcon, formatDue, priorityOf, safeHtml, timeAgo } from "./ui";

/** Optimistic edits for list and detail alike: show the change, send it, put it back if Karya says no. */
export function useItemEditor(props: {
  slug: string;
  ctx: api.Context;
  onChange: (item: api.Item) => void;
  onSignedOut: (e: unknown) => void;
  toast: (text: string, error?: boolean) => void;
}) {
  const { slug, onChange, onSignedOut, toast } = props;
  const run = useCallback(
    async (before: api.Item, after: api.Item, send: () => Promise<unknown>, done?: string) => {
      onChange(after);
      try {
        await send();
        if (done) toast(done);
        return true;
      } catch (e) {
        if (e instanceof api.SignedOut) {
          onSignedOut(e);
          return false;
        }
        onChange(before);
        toast(e instanceof Error ? e.message : "Couldn't save that.", true);
        return false;
      }
    },
    [onChange, onSignedOut, toast]
  );
  return useMemo(
    () => ({
      patch: (item: api.Item, patch: api.ItemPatch, local: Partial<api.Item>, done?: string) =>
        run(item, { ...item, ...local }, () => api.update(slug, item.project_id, item.id, patch), done),
      setState: (item: api.Item, s: api.State) =>
        s.id === item.state.id
          ? Promise.resolve(true)
          : run(
              item,
              { ...item, state: { id: s.id, name: s.name, color: s.color, group: s.group } },
              () => api.update(slug, item.project_id, item.id, { state_id: s.id }),
              `${item.key} → ${s.name}`
            ),
      setModules: (item: api.Item, ids: string[]) => {
        const add = ids.filter((id) => !item.module_ids.includes(id));
        const remove = item.module_ids.filter((id) => !ids.includes(id));
        if (!add.length && !remove.length) return Promise.resolve(true);
        return run(item, { ...item, module_ids: ids }, () =>
          api.setModules(slug, item.project_id, item.id, add, remove)
        );
      },
    }),
    [run, slug]
  );
}
export type Editor = ReturnType<typeof useItemEditor>;

const back = () => history.back();
let uploadCounter = 0;

type Picker = "state" | "people" | "priority" | "labels" | "modules" | "start" | "due" | null;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function Detail(props: {
  slug: string;
  ctx: api.Context;
  item: api.Item; // the list's copy: kept in step with every edit
  editor: Editor;
  onClose: () => void;
  onSignedOut: (e: unknown) => void;
}) {
  const { slug, ctx, item, editor } = props;
  const project = ctx.projects.find((p) => p.id === item.project_id);
  const [detail, setDetail] = useState<api.ItemDetail | null>(null);
  const [failed, setFailed] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [pending, setPending] = useState<string[]>([]); // multi-select pickers save when they close
  const [title, setTitle] = useState(item.name);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false); // the description editor
  const [uploads, setUploads] = useState<{ id: number; name: string; progress: number; error?: string }[]>([]);

  const refresh = useCallback(() => {
    api
      .item(slug, item.id)
      .then(setDetail)
      .catch((e) => (e instanceof api.SignedOut ? props.onSignedOut(e) : setFailed(e.message)));
  }, [slug, item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(refresh, [refresh]);
  useEffect(() => setTitle(item.name), [item.name]);

  // Back button / swipe-back closes the item instead of leaving the app.
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const editingNow = useRef(false); // its own back step belongs to the description editor
  editingNow.current = editing;
  useEffect(() => {
    history.pushState({ goItem: item.id }, "");
    const onPop = () => !editingNow.current && close.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [item.id]);

  const members = project?.members ?? [];
  const people = item.assignee_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as api.Member[];
  const labels = item.label_ids.map((id) => project?.labels.find((l) => l.id === id)).filter(Boolean) as api.Label[];
  const modules = item.module_ids
    .map((id) => project?.modules.find((m) => m.id === id))
    .filter(Boolean) as api.Module[];
  const priority = priorityOf(item.priority);
  const author = members.find((m) => m.id === item.created_by);
  const url = `/${slug}/browse/${item.key}/`;

  const openMulti = (which: Picker, current: string[]) => {
    setPending(current);
    setPicker(which);
  };
  const closeMulti = () => {
    if (picker === "people" && !same(pending, item.assignee_ids))
      editor.patch(item, { assignee_ids: pending }, { assignee_ids: pending }, "Assignees saved");
    if (picker === "labels" && !same(pending, item.label_ids))
      editor.patch(item, { label_ids: pending }, { label_ids: pending }, "Labels saved");
    if (picker === "modules" && !same(pending, item.module_ids)) editor.setModules(item, pending);
    setPicker(null);
  };
  const saveTitle = () => {
    const name = title.trim();
    if (!name) return setTitle(item.name);
    if (name !== item.name) editor.patch(item, { name }, { name }, "Title saved");
  };
  const saveDescription = async (html: string) => {
    const ok = await editor.patch(item, { description_html: html }, {}, "Description saved");
    if (ok) {
      setDetail((d) => d && { ...d, description_html: html });
      refresh();
    }
    return ok;
  };
  const send = async () => {
    const text = comment.trim();
    if (!text) return;
    setSending(true);
    try {
      await api.comment(slug, item.project_id, item.id, text);
      setComment("");
      refresh();
    } catch (e) {
      if (e instanceof api.SignedOut) return props.onSignedOut(e);
      setFailed(e instanceof Error ? e.message : "Couldn't post the comment.");
    } finally {
      setSending(false);
    }
  };
  const attach = async (files: File[]) => {
    const added = files.map((f) => ({ id: ++uploadCounter, name: f.name, progress: 0 }));
    const change = (id: number, patch: { progress?: number; error?: string }) =>
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setUploads((u) => [...u, ...added]);
    await Promise.all(
      files.map((file, n) =>
        upload(slug, item.project_id, item.id, file, ctx.file_size_limit, (p) =>
          change(added[n].id, { progress: p })
        ).then(
          () => change(added[n].id, { progress: 1 }),
          (e: Error) => change(added[n].id, { error: e.message })
        )
      )
    );
    refresh();
    setUploads((u) => u.filter((x) => x.error || !added.some((a) => a.id === x.id)));
  };
  const picker$ = useFilePicker(attach);

  if (!project) return null; // a project I've just been removed from
  return (
    <div
      className="fade-in bg-bg fixed inset-0 z-30 mx-auto flex max-w-lg flex-col"
      role="dialog"
      aria-label={item.key}
    >
      <header className="safe-top border-line flex items-center gap-1 border-b px-2 pb-2">
        <button onClick={back} aria-label="Back" className="rounded-full p-2 active:bg-surface-2">
          <ChevronLeft size={24} />
        </button>
        <span className="font-mono text-muted flex-1 text-[14px] font-medium">{item.key}</span>
        {"share" in navigator && (
          <button
            onClick={() =>
              navigator
                .share({ title: `${item.key} ${item.name}`, url: new URL(url, location.origin).toString() })
                .catch(() => undefined)
            }
            aria-label="Share"
            className="text-muted rounded-full p-2 active:bg-surface-2"
          >
            <Share2 size={20} />
          </button>
        )}
        <a href={url} aria-label="Open in full Karya" className="text-muted rounded-full p-2 active:bg-surface-2">
          <ExternalLink size={20} />
        </a>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={Math.min(5, Math.max(1, Math.ceil(title.length / 28)))}
          aria-label="Title"
          className="w-full resize-none bg-transparent text-[21px] leading-snug font-semibold outline-none"
        />

        <div className="border-line bg-surface mt-2 divide-y divide-[var(--line)] rounded-2xl border">
          <Prop label="Status" onClick={() => setPicker("state")}>
            <StateIcon group={item.state.group} color={item.state.color} size={16} />
            {item.state.name}
          </Prop>
          <Prop label="Assignees" onClick={() => openMulti("people", item.assignee_ids)} empty={!people.length}>
            {people.length ? (
              <>
                <span className="flex -space-x-1.5">
                  {people.slice(0, 3).map((m) => (
                    <span key={m.id} className="ring-surface rounded-full ring-2">
                      <Avatar member={m} size={20} />
                    </span>
                  ))}
                </span>
                <span className="truncate">{people.map((m) => m.display_name).join(", ")}</span>
              </>
            ) : (
              <>
                <UserRound size={16} /> No one
              </>
            )}
          </Prop>
          <Prop label="Priority" onClick={() => setPicker("priority")} empty={item.priority === "none"}>
            <Flag
              size={16}
              style={{ color: priority.color }}
              fill={item.priority === "none" ? "none" : priority.color}
            />
            {priority.label}
          </Prop>
          <Prop label="Labels" onClick={() => openMulti("labels", item.label_ids)} empty={!labels.length}>
            {labels.length ? (
              <span className="flex flex-wrap justify-end gap-1.5">
                {labels.map((l) => (
                  <span
                    key={l.id}
                    className="border-line flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px]"
                  >
                    <span className="size-2 rounded-full" style={{ background: l.color || "var(--muted)" }} />
                    {l.name}
                  </span>
                ))}
              </span>
            ) : (
              <>
                <Tag size={16} /> None
              </>
            )}
          </Prop>
          {project.modules.length > 0 && (
            <Prop label="Module" onClick={() => openMulti("modules", item.module_ids)} empty={!modules.length}>
              <Boxes size={16} />
              <span className="truncate">{modules.length ? modules.map((m) => m.name).join(", ") : "None"}</span>
            </Prop>
          )}
          <Prop label="Start date" onClick={() => setPicker("start")} empty={!item.start_date}>
            <CalendarClock size={16} />
            {item.start_date ? formatDue(item.start_date) : "None"}
          </Prop>
          <Prop label="Due date" onClick={() => setPicker("due")} empty={!item.target_date}>
            <CalendarDays size={16} />
            {item.target_date ? formatDue(item.target_date) : "None"}
          </Prop>
        </div>
        <p className="text-muted mt-2 px-1 text-[12.5px]">
          {project.emoji ? `${project.emoji} ` : ""}
          {project.name} · created {author ? `by ${author.display_name} ` : ""}
          {timeAgo(item.created_at)} · updated {timeAgo(item.updated_at)}
        </p>

        {failed && (
          <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-[#d13a2f] dark:text-[#ff8f80]">
            {failed}
          </p>
        )}

        <Section
          title="Description"
          action={
            detail && (
              <button
                onClick={() => setEditing(true)}
                className="text-coral-deep dark:text-coral -my-2 -mr-2 flex items-center gap-1 rounded-full px-3 py-2 text-[13px] font-medium active:bg-surface-2"
              >
                <Pencil size={13} /> Edit
              </button>
            )
          }
        >
          {!detail ? (
            <div className="shimmer h-16 rounded-xl" />
          ) : /<(image-component|img|mention-component|table|hr)\b/i.test(detail.description_html) ||
            detail.description_html.replace(/<[^>]*>/g, "").trim() ? (
            <div className="rich" dangerouslySetInnerHTML={{ __html: safeHtml(detail.description_html, members) }} />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="border-line text-muted w-full rounded-xl border border-dashed px-3 py-3 text-left text-[14px] active:bg-surface-2"
            >
              No description yet. Tap to add one.
            </button>
          )}
        </Section>

        <Section
          title={`Attachments${detail?.attachments.length ? ` · ${detail.attachments.length}` : ""}`}
          action={
            <button
              onClick={picker$.open}
              className="text-coral-deep dark:text-coral flex items-center gap-1 text-[13px] font-medium"
            >
              <Paperclip size={14} /> Add
            </button>
          }
        >
          {picker$.element}
          <div className="grid grid-cols-3 gap-2">
            {detail?.attachments.map((a) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border-line flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border bg-surface-2"
              >
                {a.type.startsWith("image/") ? (
                  <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
                ) : (
                  <>
                    <FileText size={26} className="text-muted" />
                    <span className="text-muted mt-1 line-clamp-2 px-1.5 text-center text-[11px]">{a.name}</span>
                  </>
                )}
              </a>
            ))}
            {uploads.map((u) => (
              <div
                key={u.id}
                className="border-line flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed px-2 text-center"
              >
                {u.error ? (
                  <span className="text-[11px] text-[#d13a2f] dark:text-[#ff8f80]">{u.error}</span>
                ) : (
                  <>
                    <Spinner className="text-muted size-5" />
                    <span className="text-muted mt-1 text-[11px]">{Math.round(u.progress * 100)}%</span>
                  </>
                )}
              </div>
            ))}
          </div>
          {detail && !detail.attachments.length && !uploads.length && (
            <p className="text-muted text-[14px]">No screenshots or files yet.</p>
          )}
        </Section>

        <Section title={`Comments${detail?.comments.length ? ` · ${detail.comments.length}` : ""}`}>
          {detail && !detail.comments.length && <p className="text-muted text-[14px]">No comments yet.</p>}
          <ul className="space-y-4">
            {detail?.comments.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar member={c.actor} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px]">
                    <span className="font-semibold">{c.actor.display_name}</span>{" "}
                    <span className="text-muted">
                      {timeAgo(c.created_at)}
                      {c.edited ? " · edited" : ""}
                    </span>
                  </p>
                  <div className="rich mt-0.5" dangerouslySetInnerHTML={{ __html: safeHtml(c.html, members) }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="safe-bottom border-line bg-bg flex items-end gap-2 border-t px-3 pt-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Write a comment"
          rows={Math.min(4, Math.max(1, comment.split("\n").length))}
          className="max-h-32 min-w-0 flex-1 resize-none rounded-2xl bg-surface-2 px-3.5 py-2.5 outline-none"
        />
        <button
          onClick={send}
          disabled={sending || !comment.trim()}
          aria-label="Send comment"
          className="bg-coral text-ink flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
        >
          {sending ? <Spinner /> : <Send size={19} />}
        </button>
      </div>

      {editing && detail && (
        <DescriptionEditor
          itemKey={item.key}
          html={detail.description_html}
          members={members}
          onSave={saveDescription}
          onClose={() => setEditing(false)}
        />
      )}
      {picker === "state" && (
        <StateSheet
          states={project.states}
          members={members}
          meId={ctx.me.id}
          value={item.state.id}
          onPick={(s) => editor.setState(item, s)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "people" && (
        <PeoplePicker
          members={members}
          meId={ctx.me.id}
          selected={pending}
          onChange={setPending}
          onClose={closeMulti}
        />
      )}
      {picker === "labels" && (
        <MultiSheet
          title="Labels"
          options={project.labels}
          selected={pending}
          onChange={setPending}
          onClose={closeMulti}
          empty="This project has no labels yet. Add them in full Karya."
        />
      )}
      {picker === "modules" && (
        <MultiSheet
          title="Module"
          options={project.modules}
          selected={pending}
          onChange={setPending}
          onClose={closeMulti}
          empty="This project has no modules."
        />
      )}
      {picker === "priority" && (
        <PrioritySheet
          value={item.priority}
          onPick={(p) => editor.patch(item, { priority: p }, { priority: p }, `Priority: ${priorityOf(p).label}`)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "start" && (
        <DateSheet
          title="Start date"
          value={item.start_date}
          onPick={(v) => editor.patch(item, { start_date: v }, { start_date: v }, "Start date saved")}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "due" && (
        <DateSheet
          title="Due date"
          value={item.target_date}
          onPick={(v) => editor.patch(item, { target_date: v }, { target_date: v }, "Due date saved")}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function Prop(props: { label: string; onClick: () => void; empty?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
    >
      <span className="text-muted w-24 shrink-0 text-[13.5px]">{props.label}</span>
      <span
        className={`flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right text-[15px] ${
          props.empty ? "text-muted" : "font-medium"
        }`}
      >
        {props.children}
      </span>
    </button>
  );
}

function Section(props: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-muted text-[11px] font-semibold tracking-wide uppercase">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}
