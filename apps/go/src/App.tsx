// Karya Go — the shell: sign-in gate, workspace and project, the two tabs.
// SPDX-License-Identifier: AGPL-3.0-only
import { ChevronDown, ListTodo, Mic, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import { takeShared } from "./attachments";
import { Capture } from "./Capture";
import { MyWork } from "./MyWork";
import { Mark, Row, Sheet, storage } from "./ui";

type Boot = { state: "loading" } | { state: "signed-out" } | { state: "error"; message: string } | { state: "ready" };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [workspaces, setWorkspaces] = useState<api.Workspace[]>([]);
  const [slug, setSlug] = useState(storage.get("workspace"));
  const [ctx, setCtx] = useState<api.Context | null>(null);
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<"new" | "mine">(() =>
    new URLSearchParams(location.search).get("tab") === "mine" ? "mine" : "new"
  );
  const [picking, setPicking] = useState(false);
  const [shared, setShared] = useState<{ files: File[]; text: string } | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof api.SignedOut) setBoot({ state: "signed-out" });
    else setBoot({ state: "error", message: e instanceof Error ? e.message : "Something went wrong." });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await api.me();
        const list = await api.workspaces();
        if (new URLSearchParams(location.search).has("shared")) {
          // Arrived from the share sheet: pick up what the service worker parked, then tidy the address.
          const got = await takeShared().catch(() => null);
          if (got && (got.files.length || got.text)) setShared(got);
          history.replaceState(null, "", "/go/");
        }
        setWorkspaces(list);
        if (!list.length) return setBoot({ state: "error", message: "You're not in any Karya workspace yet." });
        setSlug((s) => (list.some((w) => w.slug === s) ? s : list[0].slug));
      } catch (e) {
        fail(e);
      }
    })();
  }, [fail]);

  useEffect(() => {
    if (!slug || !workspaces.length) return;
    storage.set("workspace", slug);
    setCtx(null);
    (async () => {
      try {
        const c = await api.context(slug);
        setCtx(c);
        const remembered = storage.get(`project:${slug}`);
        setProjectId(c.projects.some((p) => p.id === remembered) ? remembered : (c.projects[0]?.id ?? ""));
        setBoot({ state: "ready" });
      } catch (e) {
        fail(e);
      }
    })();
  }, [slug, workspaces.length, fail]);

  const project = useMemo(() => ctx?.projects.find((p) => p.id === projectId) ?? null, [ctx, projectId]);
  const workspace = workspaces.find((w) => w.slug === slug);

  if (boot.state === "loading" || (boot.state === "ready" && !ctx))
    return (
      <div className="flex h-full items-center justify-center">
        <div className="breathe">
          <Mark size={56} />
        </div>
      </div>
    );
  if (boot.state === "signed-out") return <SignIn />;
  if (boot.state === "error")
    return (
      <Centered>
        <p className="text-muted text-center">{boot.message}</p>
        <button
          onClick={() => location.reload()}
          className="bg-coral text-ink mt-6 rounded-full px-6 py-3 font-semibold"
        >
          Try again
        </button>
      </Centered>
    );

  const choose = (id: string, ws = slug) => {
    storage.set(`project:${ws}`, id);
    setProjectId(id);
    setPicking(false);
  };

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <header className="safe-top flex items-center gap-3 px-4 pb-2">
        <Mark size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-muted text-[11px] font-medium tracking-wide uppercase">{workspace?.name}</div>
          <button
            onClick={() => setPicking(true)}
            className="-ml-1 flex max-w-full items-center gap-1 rounded-lg px-1 py-0.5 text-[17px] font-semibold active:bg-surface-2"
            aria-label="Choose project"
          >
            <span className="truncate">
              {project ? `${project.emoji ? project.emoji + " " : ""}${project.name}` : "Choose a project"}
            </span>
            <ChevronDown size={18} className="text-muted shrink-0" />
          </button>
        </div>
        <a
          href={`/${slug}/`}
          className="border-line text-muted rounded-full border px-3 py-1.5 text-[13px] font-medium active:bg-surface-2"
        >
          Full Karya
        </a>
      </header>

      <main className="relative min-h-0 flex-1">
        {tab === "new" ? (
          project && ctx ? (
            <Capture
              key={`${slug}:${project.id}`}
              slug={slug}
              project={project}
              ctx={ctx}
              shared={shared}
              onSharedUsed={() => setShared(null)}
              onSignedOut={fail}
            />
          ) : (
            <Centered>
              <p className="text-muted text-center">
                You aren't a member of any project in {workspace?.name} yet. Ask an admin to add you.
              </p>
            </Centered>
          )
        ) : (
          <MyWork slug={slug} onSignedOut={fail} />
        )}
      </main>

      <nav className="safe-bottom border-line bg-bg/95 grid grid-cols-2 border-t px-6 pt-1.5 backdrop-blur">
        <TabButton active={tab === "new"} onClick={() => setTab("new")} icon={<Mic size={22} />} label="New ticket" />
        <TabButton
          active={tab === "mine"}
          onClick={() => setTab("mine")}
          icon={<ListTodo size={22} />}
          label="My work"
        />
      </nav>

      {picking && ctx && (
        <ProjectPicker
          ctx={ctx}
          workspaces={workspaces}
          slug={slug}
          projectId={projectId}
          onWorkspace={(s) => {
            setSlug(s);
            setPicking(false);
          }}
          onProject={choose}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={props.onClick}
      aria-current={props.active ? "page" : undefined}
      className={`flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
        props.active ? "text-coral-deep dark:text-coral" : "text-muted"
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function ProjectPicker(props: {
  ctx: api.Context;
  workspaces: api.Workspace[];
  slug: string;
  projectId: string;
  onWorkspace: (slug: string) => void;
  onProject: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const projects = props.ctx.projects.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q)
  );
  return (
    <Sheet title="Where does it go?" onClose={props.onClose}>
      {props.workspaces.length > 1 && (
        <div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {props.workspaces.map((w) => (
            <button
              key={w.slug}
              onClick={() => w.slug !== props.slug && props.onWorkspace(w.slug)}
              className={`text-sm shrink-0 rounded-full border px-3.5 py-1.5 font-medium ${
                w.slug === props.slug ? "border-coral bg-coral/10" : "border-line text-muted"
              }`}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
      {props.ctx.projects.length > 6 && (
        <label className="mx-1 mb-2 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
          <Search size={18} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
        </label>
      )}
      {projects.map((p) => (
        <Row key={p.id} selected={p.id === props.projectId} onClick={() => props.onProject(p.id)}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-semibold">
            {p.emoji || p.identifier.slice(0, 3)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{p.name}</span>
            <span className="text-xs text-muted block">{p.identifier}</span>
          </span>
        </Row>
      ))}
      {!projects.length && <p className="text-muted px-3 py-6 text-center">No project matches “{query}”.</p>}
    </Sheet>
  );
}

function SignIn() {
  return (
    <Centered>
      <Mark size={72} />
      <h1 className="text-2xl mt-6 font-semibold">Karya Go</h1>
      <p className="text-muted mt-2 max-w-xs text-center">
        Say what needs doing. Karya writes the ticket and assigns it.
      </p>
      <a href={api.signInUrl()} className="bg-coral text-ink mt-8 rounded-full px-8 py-3.5 text-[16px] font-semibold">
        Sign in to Karya
      </a>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center px-8">{children}</div>;
}
