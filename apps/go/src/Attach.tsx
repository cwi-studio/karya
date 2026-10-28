// Karya Go — pick screenshots, photos or files, and show them as a strip of thumbnails.
// SPDX-License-Identifier: AGPL-3.0-only
import { AlertCircle, Check, FileText, ImagePlus, Paperclip, Plus, RotateCw, X } from "lucide-react";
import { useRef } from "react";
import { ACCEPT, MAX_FILES, type Attachment } from "./attachments";

/** One hidden input. On phones it opens the system chooser: Photo Library, Take Photo, Choose Files. */
export function useFilePicker(onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = ""; // picking the same screenshot twice still fires
        if (files.length) onFiles(files);
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

export function AttachButton(props: { onClick: () => void; count: number; compact?: boolean }) {
  if (props.compact)
    return (
      <button
        type="button"
        onClick={props.onClick}
        aria-label="Attach a screenshot or file"
        className="text-muted flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-2"
      >
        <Paperclip size={21} />
      </button>
    );
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="text-sm text-muted flex items-center gap-2 rounded-full px-4 py-2 font-medium active:bg-surface-2"
    >
      <ImagePlus size={17} />
      {props.count ? "Add more" : "Add screenshot"}
    </button>
  );
}

export function AttachmentStrip(props: {
  items: Attachment[];
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  onRetry?: (id: string) => void;
}) {
  if (!props.items.length && !props.onAdd) return null;
  return (
    <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 py-1.5" role="list" aria-label="Attachments">
      {props.items.map((a) => (
        <div key={a.id} role="listitem" className="relative shrink-0">
          <div className="border-line relative size-[72px] overflow-hidden rounded-xl border bg-surface-2">
            {a.preview ? (
              <img src={a.preview} alt={a.file.name} className="size-full object-cover" />
            ) : (
              <div className="text-muted flex size-full flex-col items-center justify-center gap-1 px-1">
                <FileText size={22} />
                <span className="w-full truncate text-center text-[10px] font-medium">
                  {a.file.name.split(".").pop()?.toUpperCase()}
                </span>
              </div>
            )}
            {a.status === "uploading" && (
              <div className="absolute inset-0 flex items-end bg-black/35">
                <div
                  className="bg-coral h-1 transition-[width]"
                  style={{ width: `${Math.max(6, a.progress * 100)}%` }}
                />
              </div>
            )}
            {a.status === "done" && (
              <span className="bg-coral text-ink absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-full">
                <Check size={13} strokeWidth={3} />
              </span>
            )}
            {a.status === "failed" && (
              <button
                onClick={() => props.onRetry?.(a.id)}
                aria-label={`Retry ${a.file.name}`}
                title={a.error}
                className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 text-[11px] font-medium text-white"
              >
                {props.onRetry ? <RotateCw size={18} /> : <AlertCircle size={18} />}
                {props.onRetry ? "Retry" : "Failed"}
              </button>
            )}
          </div>
          {props.onRemove && a.status === "ready" && (
            <button
              onClick={() => props.onRemove?.(a.id)}
              aria-label={`Remove ${a.file.name}`}
              className="bg-ink shadow ring-bg absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full text-white ring-2 dark:bg-surface-2"
            >
              <X size={13} strokeWidth={3} />
            </button>
          )}
        </div>
      ))}
      {props.onAdd && props.items.length < MAX_FILES && (
        <button
          onClick={props.onAdd}
          aria-label="Add a screenshot or file"
          className="border-line text-muted flex size-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed active:bg-surface-2"
        >
          <Plus size={20} />
          <span className="text-[10.5px] font-medium">Photo/file</span>
        </button>
      )}
    </div>
  );
}
