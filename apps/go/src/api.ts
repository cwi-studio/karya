// Karya Go — talks to the Karya API with the same session cookie as the full app.
// SPDX-License-Identifier: AGPL-3.0-only

export type Member = { id: string; display_name: string; full_name: string; avatar_url: string };
export type Module = { id: string; name: string };
export type Project = {
  id: string;
  name: string;
  identifier: string;
  emoji: string;
  members: Member[];
  modules: Module[];
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
export type MyItem = {
  id: string;
  name: string;
  key: string;
  project_id: string;
  priority: Priority;
  target_date: string | null;
  updated_at: string;
  state: { name: string; color: string; group: string };
};
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
export const mine = (slug: string) => call<MyItem[]>("GET", `/api/workspaces/${slug}/karya/go/mine/`);

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
