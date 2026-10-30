// Karya Go — every work item I can see, as a list grouped by state or as a swipeable board.
// Quick views (mine, everyone's, unassigned, mine to check), filters, sort and search; tap an item to open it.
// SPDX-License-Identifier: AGPL-3.0-only
import {
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  Flag,
  LayoutList,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquareKanban,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { Detail, useItemEditor } from "./Detail";
import { MultiSheet, PeoplePicker, StateSheet } from "./pickers";
import {
  Avatar,
  GROUPS,
  OPEN_GROUPS,
  Row,
  Sheet,
  Spinner,
  StateIcon,
  formatDue,
  priorityOf,
  storage,
  useToast,
  PRIORITIES,
} from "./ui";

type View = "list" | "board";
// The list and the board keep their own status filter: the list opens on open items, the board on every column.
type Prefs = Omit<api.ItemsQuery, "project" | "offset" | "limit" | "q"> & { view: View; boardGroups: api.StateGroup[] };

const ALL_GROUPS = GROUPS.map((g) => g.value);
const DEFAULTS: Prefs = {
  view: "list",
  scope: "all",
  groups: OPEN_GROUPS,
  boardGroups: ALL_GROUPS,
  states: [],
  priorities: [],
  assignees: [],
  labels: [],
  modules: [],
  sort: "updated",
};
const SCOPES: { value: api.Scope; label: string }[] = [
  { value: "all", label: "Everyone's" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "created", label: "I created" },
];
const SORTS: { value: api.Sort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "created", label: "Newest" },
];
const PAGE = 200;
const CLOSED_PAGE = 50; // done items pile up; the board loads the latest few and pages the rest

// One request per part, so hundreds of done items can't push open ones off the first page of the board.
type Part = { key: string; groups: api.StateGroup[]; limit: number };

type Column = { key: string; name: string; group: api.StateGroup; color: string; count: number; items: api.Item[] };

function loadPrefs(slug: string, initialScope?: api.Scope): Prefs {
  let saved: Partial<Prefs> = {};
  try {
    saved = JSON.parse(storage.get(`work:${slug}`) || "{}");
  } catch {
    /* ignore a broken entry */
  }
  return { ...DEFAULTS, ...saved, ...(initialScope ? { scope: initialScope } : {}) };
}

export function Work(props: {
  slug: string;
  ctx: api.Context;
  project: api.Project | null; // null = every project I'm in
  initialScope?: api.Scope;
  onSignedOut: (e: unknown) => void;
}) {
  const { slug, ctx, project } = props;
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(slug, props.initialScope));
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [pages, setPages] = useState<Record<string, api.ItemsPage> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"filters" | "sort" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moving, setMoving] = useState<api.Item | null>(null);
  const toast = useToast();
  const request = useRef(0);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      storage.set(`work:${slug}`, JSON.stringify(next));
      return next;
    });

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // Labels, modules and states belong to one project; drop any that don't apply to what's on screen.
  const scoped = useMemo<Prefs>(() => {
    if (!project) return { ...prefs, states: [], labels: [], modules: [] };
    const has = (list: { id: string }[]) => (id: string) => list.some((x) => x.id === id);
    return {
      ...prefs,
      states: prefs.states.filter(has(project.states)),
      labels: prefs.labels.filter(has(project.labels)),
      modules: prefs.modules.filter(has(project.modules)),
    };
  }, [prefs, project]);

  const board = prefs.view === "board";
  const groups = board ? scoped.boardGroups : scoped.groups;
  const defaultGroups = board ? ALL_GROUPS : OPEN_GROUPS;

  const parts = useMemo<Part[]>(() => {
    if (!board || scoped.states.length) return [{ key: "all", groups, limit: PAGE }];
    const open = groups.filter((g) => OPEN_GROUPS.includes(g));
    const closed = groups.filter((g) => !OPEN_GROUPS.includes(g));
    return [
      ...(open.length ? [{ key: "open", groups: open, limit: PAGE }] : []),
      ...(closed.length ? [{ key: "closed", groups: closed, limit: CLOSED_PAGE }] : []),
    ];
  }, [board, groups, scoped.states.length]);

  const baseQuery = useMemo<Omit<api.ItemsQuery, "groups">>(
    () => ({
      project: project?.id ?? "",
      scope: scoped.scope,
      states: scoped.states,
      priorities: scoped.priorities,
      assignees: scoped.assignees,
      labels: scoped.labels,
      modules: scoped.modules,
      sort: scoped.sort,
      q,
    }),
    [project, scoped, q]
  );

  const load = useCallback(() => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    Promise.all(parts.map((p) => api.items(slug, { ...baseQuery, groups: p.groups, limit: p.limit })))
      .then((got) => id === request.current && setPages(Object.fromEntries(parts.map((p, i) => [p.key, got[i]]))))
      .catch((e) => (e instanceof api.SignedOut ? props.onSignedOut(e) : id === request.current && setError(e.message)))
      .finally(() => id === request.current && setLoading(false));
  }, [slug, baseQuery, parts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);

  // Every part merged into one page; shown only once each part of the current view has loaded.
  const page = useMemo<api.ItemsPage | null>(() => {
    const got = parts.map((p) => pages?.[p.key]);
    if (got.some((p) => !p)) return null;
    const all = got as api.ItemsPage[];
    return {
      items: all.flatMap((p) => p.items),
      total: all.reduce((n, p) => n + p.total, 0),
      counts: Object.assign({}, ...all.map((p) => p.counts)),
      next_offset: null,
    };
  }, [parts, pages]);

  const loadMore = async (key: string) => {
    const part = parts.find((p) => p.key === key);
    const current = pages?.[key];
    if (!part || current?.next_offset == null) return;
    setMore(key);
    try {
      const next = await api.items(slug, {
        ...baseQuery,
        groups: part.groups,
        limit: part.limit,
        offset: current.next_offset,
      });
      setPages((ps) => {
        const p = ps?.[key];
        if (!ps || !p) return ps;
        const items = [...p.items, ...next.items.filter((i) => !p.items.some((x) => x.id === i.id))];
        return { ...ps, [key]: { ...next, items } };
      });
    } catch (e) {
      if (e instanceof api.SignedOut) return props.onSignedOut(e);
      toast.show(e instanceof Error ? e.message : "Couldn't load more.", true);
    } finally {
      setMore(null);
    }
  };
  const moreFor = (key: string) =>
    pages?.[key] && <More page={pages[key]} busy={more === key} onMore={() => loadMore(key)} />;
  const partOf = (group: api.StateGroup) => (parts.find((p) => p.groups.includes(group)) ?? parts[0]).key;

  const replace = useCallback((item: api.Item) => {
    setPages(
      (ps) =>
        ps &&
        Object.fromEntries(
          Object.entries(ps).map(([k, p]) => [
            k,
            { ...p, items: p.items.map((x) => (x.id === item.id ? { ...x, ...item } : x)) },
          ])
        )
    );
  }, []);
  const editor = useItemEditor({ slug, ctx, onChange: replace, onSignedOut: props.onSignedOut, toast: toast.show });

  const projectOf = useCallback((id: string) => ctx.projects.find((p) => p.id === id), [ctx]);
  const everyone = useMemo(() => {
    const people = new Map<string, api.Member>();
    (project ? [project] : ctx.projects).forEach((p) => p.members.forEach((m) => people.set(m.id, m)));
    return [...people.values()].toSorted((a, b) => a.display_name.localeCompare(b.display_name));
  }, [ctx, project]);

  const columns = useMemo<Column[]>(() => {
    if (!page) return [];
    if (project) {
      const shown = project.states.filter((s) =>
        scoped.states.length ? scoped.states.includes(s.id) : groups.includes(s.group)
      );
      return shown.map((s) => ({
        key: s.id,
        name: s.name,
        group: s.group,
        color: s.color,
        count: page.counts[s.id] ?? 0,
        items: page.items.filter((i) => i.state.id === s.id),
      }));
    }
    const groupOfState = new Map(ctx.projects.flatMap((p) => p.states.map((s) => [s.id, s.group] as const)));
    return GROUPS.filter((g) => groups.includes(g.value)).map((g) => ({
      key: g.value,
      name: g.label,
      group: g.value,
      color: g.color,
      count: Object.entries(page.counts).reduce((n, [id, c]) => n + (groupOfState.get(id) === g.value ? c : 0), 0),
      items: page.items.filter((i) => i.state.group === g.value),
    }));
  }, [page, project, scoped, groups, ctx]);

  const filterCount =
    (groups.join() !== defaultGroups.join() || scoped.states.length ? 1 : 0) +
    (scoped.priorities.length ? 1 : 0) +
    (scoped.assignees.length ? 1 : 0) +
    (scoped.labels.length ? 1 : 0) +
    (scoped.modules.length ? 1 : 0);

  const open = page?.items.find((i) => i.id === openId) ?? null;
  const card = (item: api.Item) => (
    <Card
      key={item.id}
      item={item}
      project={projectOf(item.project_id)}
      showProject={!project}
      onOpen={() => setOpenId(item.id)}
      onState={() => setMoving(item)}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-4 pt-1 pb-2">
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <Search size={17} className="text-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or ID"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="text-muted">
                <X size={16} />
              </button>
            )}
          </label>
          <div className="border-line flex rounded-xl border p-0.5" role="group" aria-label="View">
            <IconToggle on={prefs.view === "list"} label="List" onClick={() => update({ view: "list" })}>
              <LayoutList size={18} />
            </IconToggle>
            <IconToggle on={prefs.view === "board"} label="Board" onClick={() => update({ view: "board" })}>
              <SquareKanban size={18} />
            </IconToggle>
          </div>
          <button onClick={load} aria-label="Refresh" className="text-muted rounded-full p-2 active:bg-surface-2">
            {loading ? <Spinner className="size-[18px]" /> : <RefreshCw size={18} />}
          </button>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {SCOPES.map((s) => (
            <Pill key={s.value} on={prefs.scope === s.value} onClick={() => update({ scope: s.value })}>
              {s.label}
            </Pill>
          ))}
          <span className="bg-line my-1.5 w-px shrink-0" />
          <Pill on={filterCount > 0} onClick={() => setSheet("filters")}>
            <SlidersHorizontal size={14} /> Filters{filterCount ? ` · ${filterCount}` : ""}
          </Pill>
          <Pill on={false} onClick={() => setSheet("sort")}>
            <ArrowUpDown size={14} /> {SORTS.find((s) => s.value === prefs.sort)?.label}
          </Pill>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {error && <p className="text-muted px-6 py-10 text-center">{error}</p>}
        {!page && !error && (
          <div className="space-y-2 px-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer h-[72px] rounded-2xl" />
            ))}
          </div>
        )}
        {page && !error && !page.total && (
          <p className="text-muted px-8 py-16 text-center">
            {q
              ? `Nothing matches “${q}”.`
              : prefs.scope === "mine"
                ? "Nothing here is assigned to you."
                : "No work items here."}
          </p>
        )}
        {page && !error && page.total > 0 && prefs.view === "list" && (
          <ListView columns={columns} card={card} footer={moreFor(parts[0].key)} />
        )}
        {page && !error && page.total > 0 && prefs.view === "board" && (
          <BoardView columns={columns} card={card} footer={(c) => moreFor(partOf(c.group))} />
        )}
      </div>

      {sheet === "sort" && (
        <Sheet title="Sort by" onClose={() => setSheet(null)}>
          {SORTS.map((s) => (
            <Row
              key={s.value}
              selected={prefs.sort === s.value}
              onClick={() => {
                update({ sort: s.value });
                setSheet(null);
              }}
            >
              {s.label}
            </Row>
          ))}
        </Sheet>
      )}
      {sheet === "filters" && (
        <Filters
          prefs={{ ...scoped, groups }}
          defaultGroups={defaultGroups}
          project={project}
          people={everyone}
          meId={ctx.me.id}
          onChange={({ groups: g, ...rest }) => update(g ? { ...rest, [board ? "boardGroups" : "groups"]: g } : rest)}
          onClose={() => setSheet(null)}
        />
      )}
      {moving && projectOf(moving.project_id) && (
        <StateSheet
          states={projectOf(moving.project_id)!.states}
          members={projectOf(moving.project_id)!.members}
          meId={ctx.me.id}
          value={moving.state.id}
          onPick={(s) => editor.setState(moving, s)}
          onClose={() => setMoving(null)}
        />
      )}
      {open && (
        <Detail
          slug={slug}
          ctx={ctx}
          item={open}
          editor={editor}
          onClose={() => setOpenId(null)}
          onSignedOut={props.onSignedOut}
        />
      )}
      {toast.element}
    </div>
  );
}

function ListView(props: { columns: Column[]; card: (i: api.Item) => React.ReactNode; footer: React.ReactNode }) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  return (
    <div className="h-full overflow-y-auto px-3 pb-6">
      {props.columns
        .filter((c) => c.count > 0 || c.items.length > 0)
        .map((c) => {
          const shut = closed.has(c.key);
          return (
            <section key={c.key} className="mb-2">
              <button
                onClick={() =>
                  setClosed((s) => {
                    const next = new Set(s);
                    if (shut) next.delete(c.key);
                    else next.add(c.key);
                    return next;
                  })
                }
                aria-expanded={!shut}
                className="bg-bg/95 sticky top-0 z-10 flex w-full items-center gap-2 px-2 py-2 text-left backdrop-blur"
              >
                <StateIcon group={c.group} color={c.color} size={16} />
                <span className="text-[14px] font-semibold">{c.name}</span>
                <span className="text-muted text-[13px]">{c.count}</span>
                <ChevronDown
                  size={16}
                  className={`text-muted ml-auto transition-transform ${shut ? "-rotate-90" : ""}`}
                />
              </button>
              {!shut && (
                <ul className="space-y-2">
                  {c.items.map((i) => (
                    <li key={i.id}>{props.card(i)}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      {props.footer}
    </div>
  );
}

function BoardView(props: {
  columns: Column[];
  card: (i: api.Item) => React.ReactNode;
  footer: (c: Column) => React.ReactNode;
}) {
  return (
    <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
      {props.columns.map((c) => (
        <section
          key={c.key}
          className="flex h-full w-[84%] max-w-[340px] shrink-0 snap-center flex-col rounded-2xl bg-surface-2/60"
        >
          <header className="flex items-center gap-2 px-3 pt-3 pb-2">
            <StateIcon group={c.group} color={c.color} size={16} />
            <span className="truncate text-[14px] font-semibold">{c.name}</span>
            <span className="text-muted text-[13px]">{c.count}</span>
          </header>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {c.items.map((i) => (
              <li key={i.id}>{props.card(i)}</li>
            ))}
            {!c.items.length && <li className="text-muted px-2 py-8 text-center text-[13px]">Nothing here</li>}
            {c.items.length < c.count && <li>{props.footer(c)}</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

function More(props: { page: api.ItemsPage; busy: boolean; onMore: () => void }) {
  if (props.page.next_offset == null) return null;
  return (
    <div className="flex justify-center py-3">
      <button
        onClick={props.onMore}
        disabled={props.busy}
        className="border-line text-muted flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium active:bg-surface-2"
      >
        {props.busy && <Spinner className="size-4" />}
        Show more ({props.page.total - props.page.items.length} left)
      </button>
    </div>
  );
}

function Card(props: {
  item: api.Item;
  project?: api.Project;
  showProject: boolean;
  onOpen: () => void;
  onState: () => void;
}) {
  const { item } = props;
  const p = priorityOf(item.priority);
  const today = new Date().toLocaleDateString("en-CA");
  const late = item.target_date && item.target_date < today && !["completed", "cancelled"].includes(item.state.group);
  const people = item.assignee_ids
    .map((id) => props.project?.members.find((m) => m.id === id))
    .filter(Boolean) as api.Member[];
  const labels = item.label_ids
    .map((id) => props.project?.labels.find((l) => l.id === id))
    .filter(Boolean) as api.Label[];
  return (
    <div className="border-line bg-surface flex rounded-2xl border">
      <button
        onClick={props.onState}
        aria-label={`State: ${item.state.name}. Change`}
        className="flex w-11 shrink-0 justify-center rounded-l-2xl pt-3.5 active:bg-surface-2"
      >
        <StateIcon group={item.state.group} color={item.state.color} size={18} />
      </button>
      <button onClick={props.onOpen} className="min-w-0 flex-1 rounded-r-2xl py-3 pr-3 text-left active:bg-surface-2">
        <span className="line-clamp-2 text-[15px] leading-snug font-medium">{item.name}</span>
        <span className="text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <span className="font-mono">{item.key}</span>
          {props.showProject && <span>{item.state.name}</span>} {/* one project: the section already says it */}
          {item.priority !== "none" && (
            <span className="flex items-center gap-1">
              <Flag size={12} style={{ color: p.color }} fill={p.color} />
              {p.label}
            </span>
          )}
          {item.target_date && (
            <span className={`flex items-center gap-1 ${late ? "font-medium text-[#d13a2f] dark:text-[#ff8f80]" : ""}`}>
              <CalendarDays size={12} />
              {formatDue(item.target_date)}
            </span>
          )}
          {labels.slice(0, 2).map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: l.color || "var(--muted)" }} />
              {l.name}
            </span>
          ))}
          {people.length > 0 && (
            <span className="ml-auto flex -space-x-1.5">
              {people.slice(0, 3).map((m) => (
                <span key={m.id} className="ring-surface rounded-full ring-2">
                  <Avatar member={m} size={20} />
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
const names = (ids: string[], from: { id: string; name?: string; display_name?: string }[]) =>
  ids
    .map((id) => {
      if (id === "none") return "No one";
      const found = from.find((x) => x.id === id);
      return found?.name ?? found?.display_name;
    })
    .filter(Boolean)
    .join(", ");

function Filters(props: {
  prefs: Prefs;
  defaultGroups: api.StateGroup[];
  project: api.Project | null;
  people: api.Member[];
  meId: string;
  onChange: (patch: Partial<Prefs>) => void;
  onClose: () => void;
}) {
  const [sub, setSub] = useState<"people" | "labels" | "modules" | null>(null);
  const { prefs, project, defaultGroups } = props;

  if (sub === "people")
    return (
      <PeoplePicker
        title="Assigned to"
        members={props.people}
        meId={props.meId}
        selected={prefs.assignees}
        onChange={(ids) => props.onChange({ assignees: ids })}
        onClose={() => setSub(null)}
        noOne
      />
    );
  if (sub === "labels" && project)
    return (
      <MultiSheet
        title="Labels"
        options={project.labels}
        selected={prefs.labels}
        onChange={(ids) => props.onChange({ labels: ids })}
        onClose={() => setSub(null)}
        empty="This project has no labels."
      />
    );
  if (sub === "modules" && project)
    return (
      <MultiSheet
        title="Modules"
        options={project.modules}
        selected={prefs.modules}
        onChange={(ids) => props.onChange({ modules: ids })}
        onClose={() => setSub(null)}
        empty="This project has no modules."
      />
    );

  return (
    <Sheet
      title="Filters"
      onClose={props.onClose}
      footer={
        <div className="mb-1 flex gap-3">
          <button
            onClick={() =>
              props.onChange({
                groups: defaultGroups,
                states: [],
                priorities: [],
                assignees: [],
                labels: [],
                modules: [],
              })
            }
            className="border-line text-muted rounded-full border px-5 py-3 font-medium"
          >
            Reset
          </button>
          <button onClick={props.onClose} className="bg-coral text-ink flex-1 rounded-full py-3 font-semibold">
            Show
          </button>
        </div>
      }
    >
      <Heading>Status</Heading>
      <div className="flex flex-wrap gap-2 px-2 pb-2">
        {project
          ? project.states.map((s) => {
              const on = prefs.states.length ? prefs.states.includes(s.id) : prefs.groups.includes(s.group);
              return (
                <Pill
                  key={s.id}
                  on={on}
                  onClick={() => {
                    const current = prefs.states.length
                      ? prefs.states
                      : project.states.filter((x) => prefs.groups.includes(x.group)).map((x) => x.id);
                    const next = toggle(current, s.id);
                    props.onChange(next.length ? { states: next } : { states: [], groups: defaultGroups });
                  }}
                >
                  <StateIcon group={s.group} color={s.color} /> {s.name}
                </Pill>
              );
            })
          : GROUPS.map((g) => (
              <Pill
                key={g.value}
                on={prefs.groups.includes(g.value)}
                onClick={() => {
                  const next = toggle(prefs.groups, g.value);
                  props.onChange({ groups: next.length ? next : defaultGroups });
                }}
              >
                <StateIcon group={g.value} color={g.color} /> {g.label}
              </Pill>
            ))}
      </div>
      <div className="flex gap-2 px-2 pb-3">
        <button
          onClick={() => props.onChange({ states: [], groups: OPEN_GROUPS })}
          className="text-coral-deep dark:text-coral text-[13px] font-medium"
        >
          Open only
        </button>
        <span className="text-muted">·</span>
        <button
          onClick={() => props.onChange({ states: [], groups: ALL_GROUPS })}
          className="text-coral-deep dark:text-coral text-[13px] font-medium"
        >
          Everything, incl. done
        </button>
      </div>

      <Heading>Priority</Heading>
      <div className="flex flex-wrap gap-2 px-2 pb-3">
        {PRIORITIES.map((p) => (
          <Pill
            key={p.value}
            on={prefs.priorities.includes(p.value)}
            onClick={() => props.onChange({ priorities: toggle(prefs.priorities, p.value) })}
          >
            <Flag size={13} style={{ color: p.color }} fill={p.value === "none" ? "none" : p.color} /> {p.label}
          </Pill>
        ))}
      </div>

      <Row onClick={() => setSub("people")}>
        <span className="flex-1">Assigned to</span>
        <span className="text-muted max-w-[55%] truncate text-[14px]">
          {prefs.assignees.length ? names(prefs.assignees, props.people) : "Anyone"}
        </span>
      </Row>
      {project && project.labels.length > 0 && (
        <Row onClick={() => setSub("labels")}>
          <span className="flex-1">Labels</span>
          <span className="text-muted max-w-[55%] truncate text-[14px]">
            {prefs.labels.length ? names(prefs.labels, project.labels) : "Any"}
          </span>
        </Row>
      )}
      {project && project.modules.length > 0 && (
        <Row onClick={() => setSub("modules")}>
          <span className="flex-1">Module</span>
          <span className="text-muted max-w-[55%] truncate text-[14px]">
            {prefs.modules.length ? names(prefs.modules, project.modules) : "Any"}
          </span>
        </Row>
      )}
      {!project && (
        <p className="text-muted px-3 pt-2 text-[13px]">
          Pick one project at the top to filter by its labels and modules.
        </p>
      )}
    </Sheet>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted px-3 pt-2 pb-2 text-[11px] font-semibold tracking-wide uppercase">{children}</h3>;
}

function Pill(props: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.on}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-medium whitespace-nowrap active:scale-95 ${
        props.on ? "border-coral bg-coral/12 text-text" : "border-line text-muted"
      }`}
    >
      {props.children}
    </button>
  );
}

function IconToggle(props: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      aria-label={props.label}
      aria-pressed={props.on}
      className={`rounded-lg p-1.5 ${props.on ? "text-text bg-surface-2" : "text-muted"}`}
    >
      {props.children}
    </button>
  );
}
