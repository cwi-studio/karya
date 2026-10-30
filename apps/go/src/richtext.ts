// Karya Go — the description on a phone: full Karya's HTML in, plain editable rich text out, nothing lost.
// Text, bold, italic, headings, lists, quotes, code and links are edited in place. Everything Go can't edit
// well on a phone (images, mentions, emoji, tables, checklists, dividers) becomes a locked chip that keeps
// the exact original HTML and is written back untouched, so saving from Go never strips what full Karya made.
// SPDX-License-Identifier: AGPL-3.0-only
import type { Member } from "./api";

const KEEP_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "BR"]);
const MARKS: Record<string, string> = {
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  CODE: "code",
  SUB: "sub",
  SUP: "sup",
};
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "META", "LINK"]);
const BLOCK_ATOMS = new Set(["IMAGE-COMPONENT", "IMG", "TABLE", "HR"]);
const INLINE_ATOMS = new Set(["MENTION-COMPONENT"]);

export type Editable = { html: string; kept: string[] };

/** What a locked chip says, or null when the element is ordinary editable text. */
function atomOf(el: Element, names: Map<string, string>): { label: string; block: boolean } | null {
  const tag = el.tagName;
  const type = el.getAttribute("data-type") ?? "";
  if (tag === "IMAGE-COMPONENT" || tag === "IMG") return { label: "🖼 Image", block: true };
  if (tag === "TABLE") return { label: "▦ Table · edit in full Karya", block: true };
  if (tag === "HR" || type === "horizontalRule") return { label: "— Divider", block: true };
  if (type === "taskList") return { label: "☑ Checklist · edit in full Karya", block: true };
  if (tag === "MENTION-COMPONENT") {
    const who =
      el.getAttribute("entity_name") === "user_mention" && names.get(el.getAttribute("entity_identifier") ?? "");
    return { label: `@${who || "someone"}`, block: false };
  }
  if (type === "emoji") return { label: el.textContent || "🙂", block: false };
  if (BLOCK_ATOMS.has(tag) || INLINE_ATOMS.has(tag) || (tag.includes("-") && !DROP.has(tag))) {
    return { label: "◆ Embedded block · edit in full Karya", block: true };
  }
  if (tag === "DIV" && type) return { label: "◆ Embedded block · edit in full Karya", block: true };
  return null;
}

/** Description HTML → markup for the contenteditable, plus the originals of every locked chip. */
export function toEditable(html: string, members: Member[]): Editable {
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const kept: string[] = [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.createElement("div");
  const walk = (from: Node, to: Node) => {
    from.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return to.appendChild(document.createTextNode(node.textContent ?? ""));
      if (!(node instanceof Element) || DROP.has(node.tagName)) return;
      const atom = atomOf(node, names);
      if (atom) {
        const chip = document.createElement(atom.block ? "div" : "span");
        chip.className = atom.block ? "atom atom-block" : "atom";
        chip.contentEditable = "false";
        chip.dataset.keep = String(kept.length);
        chip.textContent = atom.label;
        kept.push(node.outerHTML);
        return to.appendChild(chip);
      }
      const tag = node.tagName;
      if (tag === "A") {
        const a = document.createElement("a");
        const href = node.getAttribute("href") ?? "";
        if (/^(https?:|mailto:|\/)/i.test(href)) a.setAttribute("href", href);
        walk(node, a);
        return to.appendChild(a);
      }
      const name = MARKS[tag] ?? (KEEP_TAGS.has(tag) ? tag.toLowerCase() : null);
      if (name) {
        const copy = document.createElement(name);
        walk(node, copy);
        return to.appendChild(copy);
      }
      walk(node, to); // span, plain div, label…: keep what's inside
    });
  };
  walk(doc.body, out);
  // An empty description starts truly empty, so the placeholder shows.
  return { html: kept.length || out.textContent?.trim() ? out.innerHTML : "", kept };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BLOCKISH = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE"]);

/** The edited contenteditable → description HTML in the shape full Karya's editor reads back. */
export function fromEditable(root: HTMLElement, kept: string[]): string {
  // Inline runs between blocks become their own paragraph: <p> is the only top-level text Karya takes.
  const blocks = (parent: Node, inList = false): string => {
    let html = "";
    let run = "";
    const flush = () => {
      if (run.replace(/<br>/g, "").trim()) html += `<p>${run.replace(/(<br>)+$/, "")}</p>`;
      run = "";
    };
    parent.childNodes.forEach((node) => {
      if (node instanceof HTMLElement && node.dataset.keep !== undefined && node.classList.contains("atom-block")) {
        flush();
        html += kept[Number(node.dataset.keep)] ?? "";
        return;
      }
      if (!(node instanceof HTMLElement) || !BLOCKISH.has(node.tagName)) {
        run += inline(node);
        return;
      }
      flush();
      const tag = node.tagName;
      if (tag === "UL" || tag === "OL") {
        const items = Array.from(node.children)
          .map((li) => (li.tagName === "LI" ? `<li>${blocks(li, true) || "<p></p>"}</li>` : ""))
          .join("");
        if (items) html += `<${tag.toLowerCase()}>${items}</${tag.toLowerCase()}>`;
      } else if (tag === "BLOCKQUOTE") {
        const body = blocks(node);
        if (body) html += `<blockquote>${body}</blockquote>`;
      } else if (tag === "PRE") {
        if (node.textContent?.trim()) html += `<pre><code>${esc(node.textContent)}</code></pre>`;
      } else if (/^H[1-6]$/.test(tag)) {
        const text = inline(node, true);
        if (text.trim()) html += `<${tag.toLowerCase()}>${text}</${tag.toLowerCase()}>`;
      } else if (tag === "LI") {
        html += `<li>${blocks(node, true)}</li>`; // stray item outside a list: kept as is
      } else if (Array.from(node.children).some((c) => BLOCKISH.has(c.tagName) || c.classList.contains("atom-block"))) {
        html += blocks(node, inList); // a wrapper div around real blocks
      } else {
        const text = inline(node, true);
        if (text.replace(/<br>/g, "").trim()) html += `<p>${text.replace(/(<br>)+$/, "")}</p>`;
        else if (!inList) html += "<p></p>"; // an empty line the person left on purpose
      }
    });
    flush();
    return html;
  };

  const inline = (node: Node, children = false): string => {
    if (children)
      return Array.from(node.childNodes)
        .map((n) => inline(n))
        .join("");
    if (node.nodeType === Node.TEXT_NODE) return esc((node.textContent ?? "").replace(/ /g, " "));
    if (!(node instanceof HTMLElement)) return "";
    if (node.dataset.keep !== undefined) return kept[Number(node.dataset.keep)] ?? "";
    const tag = node.tagName;
    if (tag === "BR") return "<br>";
    if (DROP.has(tag)) return "";
    if (tag === "A") {
      const href = node.getAttribute("href") ?? "";
      const body = inline(node, true);
      return /^(https?:|mailto:|\/)/i.test(href)
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${body}</a>`
        : body;
    }
    const mark = MARKS[tag];
    const body = inline(node, true);
    if (mark && body) return `<${mark}>${body}</${mark}>`;
    return body; // span, font, stray block inside a line: keep the text
  };

  const html = blocks(root).replace(/^(<p><\/p>)+|(<p><\/p>)+$/g, "");
  return html || "<p></p>";
}
