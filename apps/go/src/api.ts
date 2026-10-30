// Karya Go — talks to the Karya API with the same session cookie as the full app.
// SPDX-License-Identifier: AGPL-3.0-only

export type Member = { id: string; display_name: string; full_name: string; avatar_url: string };
export type Module = { id: string; name: string };
export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";
export type State = {
  id: string;
  name: string;
  color: string;
  group: StateGroup;
  default: boolean;
  approver_ids: string[]; // empty = anyone may move work items here
};
export type Label = { id: string; name: string; color: string };
export type Project = {
  id: string;
  name: string;
  identifier: string;
  emoji: string;
  members: Member[];
  modules: Module[];
  states: State[];
  labels: Label[];
};
export type Workspace = { id: string; slug: string; name: string };
export type Context = {
  me: { id: string; display_name: string };
  voice: boolean;
  smart: boolean;
  file_size_limit: number;
  projects: Project[];
};
export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type Draft = {
  title: string;
  description: string;
  assignee_ids: string[];
  priority: Priority;
  target_date: string | null;
  module_id: string | null;
};
export type DraftResult = { transcript: string; understood: boolean; draft: Draft };
export type Item = {
  id: string;
  name: string;
  key: string;
  project_id: string;
  priority: Priority;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  state: { id: string | null; name: string; color: string; group: StateGroup };
  assignee_ids: string[];
  label_ids: string[];
  module_ids: string[];
};
export type Comment = {
  id: string;
  html: string;
  created_at: string;
  edited: boolean;
  actor: { id: string; display_name: string; avatar_url: string };
};
export type FileLink = { id: string; name: string; size: number; type: string; url: string };
export type ItemDetail = Item & { description_html: string; comments: Comment[]; attachments: FileLink[] };
export type ItemsPage = { items: Item[]; total: number; counts: Record<string, number>; next_offset: number | null };
export type Scope = "all" | "mine" | "created" | "unassigned";
export type Sort = "updated" | "due" | "priority" | "created";
export type ItemsQuery = {
  project?: string; // empty = every project I'm in
  scope: Scope;
  groups: StateGroup[];
  states: string[];
  priorities: Priority[];
  assignees: string[]; // user ids, "none" = nobody
  labels: string[];
  modules: string[];
  q: string;
  sort: Sort;
  offset?: number;
  limit?: number;
};
/** What a work item edit may send to upstream's PATCH (the same fields the full app sends). */
export type ItemPatch = Partial<{
  name: string;
  state_id: string;
  priority: Priority;
  assignee_ids: string[];
  label_ids: string[];
  start_date: string | null;
  target_date: string | null;
}>;
export type Created = { id: string; key: string; url: string; projectId: string };

export class SignedOut extends Error {}

async function call<T>(method: string, url: string, body?: FormData | object): Promise<T> {
  const init: RequestInit = { method, credentials: "include", headers: { Accept: "application/json" } };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("You're offline. Check your connection and try again.");
  }
  if (response.status === 401) throw new SignedOut();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data && (data.error || data.detail)) || `Something went wrong (${response.status}).`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data as T;
}

export const signInUrl = () => `/?next_path=${encodeURIComponent("/go/")}`;

export const me = () => call<{ id: string; display_name: string; email: string }>("GET", "/api/users/me/");
export const workspaces = () => call<Workspace[]>("GET", "/api/users/me/workspaces/");
export const context = (slug: string) => call<Context>("GET", `/api/workspaces/${slug}/karya/go/context/`);

export function items(slug: string, query: ItemsQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const text = Array.isArray(value) ? value.join(",") : value == null ? "" : String(value);
    if (text) params.set(key, text);
  }
  return call<ItemsPage>("GET", `/api/workspaces/${slug}/karya/go/items/?${params}`);
}
export const item = (slug: string, id: string) =>
  call<ItemDetail>("GET", `/api/workspaces/${slug}/karya/go/items/${id}/`);

// Edits go through upstream's own endpoints, so activity, notifications and the approver guard apply as in full Karya.
const issueUrl = (slug: string, projectId: string, id: string) =>
  `/api/workspaces/${slug}/projects/${projectId}/issues/${id}/`;
export const update = (slug: string, projectId: string, id: string, patch: ItemPatch) =>
  call<void>("PATCH", issueUrl(slug, projectId, id), patch);
export const setModules = (slug: string, projectId: string, id: string, add: string[], remove: string[]) =>
  call<void>("POST", `${issueUrl(slug, projectId, id)}modules/`, { modules: add, removed_modules: remove });
export const comment = (slug: string, projectId: string, id: string, text: string) =>
  call<void>("POST", `${issueUrl(slug, projectId, id)}comments/`, {
    comment_html: text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join(""),
  });

export function draft(slug: string, projectId: string, input: Blob | string) {
  const form = new FormData();
  form.append("project_id", projectId);
  if (typeof input === "string") form.append("text", input);
  else form.append("audio", input, `speech.${input.type.includes("mp4") ? "m4a" : "webm"}`);
  return call<DraftResult>("POST", `/api/workspaces/${slug}/karya/go/draft/`, form);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function descriptionHtml(description: string, transcript: string) {
  const paragraphs = description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`);
  if (transcript && transcript.trim() !== description.trim())
    paragraphs.push(`<blockquote><p>Said in Karya Go: “${escapeHtml(transcript.trim())}”</p></blockquote>`);
  return paragraphs.join("") || "<p></p>";
}

export async function create(slug: string, project: Project, d: Draft, transcript: string): Promise<Created> {
  const issue = await call<{ id: string; sequence_id: number }>(
    "POST",
    `/api/workspaces/${slug}/projects/${project.id}/issues/`,
    {
      name: d.title.trim(),
      description_html: descriptionHtml(d.description, transcript),
      assignee_ids: d.assignee_ids,
      priority: d.priority,
      target_date: d.target_date,
    }
  );
  if (d.module_id) {
    // The ticket exists either way; a failed module link is not worth failing the whole create.
    await call("POST", `/api/workspaces/${slug}/projects/${project.id}/issues/${issue.id}/modules/`, {
      modules: [d.module_id],
      removed_modules: [],
    }).catch(() => undefined);
  }
  const key = `${project.identifier}-${issue.sequence_id}`;
  return { id: issue.id, key, url: `/${slug}/browse/${key}/`, projectId: project.id };
}
