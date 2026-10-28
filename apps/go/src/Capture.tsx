// Karya Go — speak (or type) → review → create → done.
// SPDX-License-Identifier: AGPL-3.0-only
import { ArrowUp, Keyboard, Mic, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { AttachButton, AttachmentStrip, useFilePicker } from "./Attach";
import { MAX_FILES, release, toAttachment, upload, type Attachment } from "./attachments";
import { MAX_SECONDS, canRecord, useRecorder } from "./recorder";
import { Done, Review } from "./Review";

type Phase =
  | { name: "capture" }
  | { name: "thinking"; heard: string }
  | { name: "review"; result: api.DraftResult }
  | { name: "done"; created: api.Created; draft: api.Draft };

const EXAMPLES = [
  "Mayank, the fee receipt PDF cuts off the school logo. Urgent, by Friday.",
  "Ashish ko bolo login page pe OTP nahi aa raha, aaj hi dekhna hai.",
  "Add a Hindi option to the parent app's language menu. Low priority.",
];

export function Capture(props: {
  slug: string;
  project: api.Project;
  ctx: api.Context;
  shared?: { files: File[]; text: string } | null;
  onSharedUsed?: () => void; // shared files follow a project switch until a ticket is made
  onSignedOut: (e: unknown) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [typing, setTyping] = useState(!props.ctx.voice || !canRecord() || !!props.shared?.text);
  const [text, setText] = useState(props.shared?.text ?? "");
  const [example] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);
  const [files, setFiles] = useState<Attachment[]>(() =>
    (props.shared?.files ?? []).slice(0, MAX_FILES).map(toAttachment)
  );
  const filesRef = useRef(files);
  filesRef.current = files;

  const addFiles = useCallback((picked: File[]) => {
    setFiles((current) => [...current, ...picked.slice(0, MAX_FILES - current.length).map(toAttachment)]);
  }, []);
  const removeFile = (id: string) =>
    setFiles((current) => {
      release(current.filter((a) => a.id === id));
      return current.filter((a) => a.id !== id);
    });
  const picker = useFilePicker(addFiles);

  // Screenshots pasted from the clipboard (iPad, desktop, Android keyboards that paste images).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        addFiles(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);
  useEffect(() => () => release(filesRef.current), []);

  const patch = (id: string, change: Partial<Attachment>) =>
    setFiles((current) => current.map((a) => (a.id === id ? { ...a, ...change } : a)));
  const uploadOne = async (created: api.Created, a: Attachment) => {
    patch(a.id, { status: "uploading", progress: 0, error: undefined });
    try {
      await upload(props.slug, created.projectId, created.id, a.file, props.ctx.file_size_limit, (progress) =>
        patch(a.id, { progress })
      );
      patch(a.id, { status: "done", progress: 1 });
    } catch (e) {
      patch(a.id, { status: "failed", error: e instanceof Error ? e.message : "Upload failed." });
    }
  };
  const startOver = () => {
    release(filesRef.current);
    setFiles([]);
    setPhase({ name: "capture" });
  };

  const run = async (input: Blob | string) => {
    setPhase({ name: "thinking", heard: typeof input === "string" ? input : "" });
    try {
      const result = await api.draft(props.slug, props.project.id, input);
      setPhase({ name: "review", result });
      setText("");
    } catch (e) {
      if (e instanceof api.SignedOut) return props.onSignedOut(e);
      recorder.setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase({ name: "capture" });
    }
  };

  const recorder = useRecorder((clip) => {
    if (!clip) return recorder.setError("That was too short. Tap, speak, then tap again.");
    run(clip);
  });
  const recording = recorder.status === "recording";

  const wrap = (node: React.ReactNode) => (
    <>
      {picker.element}
      {node}
    </>
  );

  if (phase.name === "review")
    return wrap(
      <Review
        slug={props.slug}
        project={props.project}
        ctx={props.ctx}
        result={phase.result}
        files={files}
        onAddFiles={picker.open}
        onRemoveFile={removeFile}
        onCancel={() => setPhase({ name: "capture" })}
        onCreated={(created, draft) => {
          navigator.vibrate?.([20, 40, 20]);
          props.onSharedUsed?.();
          setPhase({ name: "done", created, draft });
          // One at a time: phones on mobile data do better with a single upload in flight.
          (async () => {
            // oxlint-disable-next-line no-await-in-loop -- deliberate: one upload at a time
            for (const a of filesRef.current) await uploadOne(created, a);
          })();
        }}
        onSignedOut={props.onSignedOut}
      />
    );
  if (phase.name === "done")
    return wrap(
      <Done
        project={props.project}
        created={phase.created}
        draft={phase.draft}
        files={files}
        onRetry={(id) => {
          const a = files.find((f) => f.id === id);
          if (a) uploadOne(phase.created, a);
        }}
        onAnother={startOver}
      />
    );

  const thinking = phase.name === "thinking";
  const remaining = MAX_SECONDS - recorder.seconds;

  return wrap(
    <div className="flex h-full flex-col px-5">
      <div className="flex flex-1 flex-col items-center justify-center">
        {thinking ? (
          <Thinking heard={phase.heard} />
        ) : (
          <>
            <p className="text-muted mb-10 max-w-[19rem] text-center text-[15px] leading-relaxed" aria-live="polite">
              {recording ? (
                <span className="text-text font-medium">
                  Listening… <span className="tabular-nums">{remaining <= 10 ? `${remaining}s left` : ""}</span>
                </span>
              ) : typing ? (
                "Type what needs doing, who should do it and by when."
              ) : (
                <>
                  Tap and say what needs doing.
                  <span className="mt-2 block text-[13px] italic opacity-80">“{example}”</span>
                </>
              )}
            </p>

            {!typing && (
              <div className="relative flex items-center justify-center">
                {recording && (
                  <span
                    aria-hidden
                    className="bg-coral/25 absolute rounded-full transition-transform duration-75"
                    style={{ width: 168, height: 168, transform: `scale(${1 + recorder.level * 0.45})` }}
                  />
                )}
                <button
                  onClick={recording ? recorder.stop : recorder.start}
                  aria-label={recording ? "Stop and write the ticket" : "Start speaking"}
                  className={`relative flex size-36 items-center justify-center rounded-full shadow-[0_12px_40px_-8px_rgba(255,122,89,0.65)] transition-transform active:scale-95 ${
                    recording ? "bg-ink text-coral dark:bg-coral dark:text-ink" : "bg-coral text-ink"
                  }`}
                >
                  {recording ? <Square size={40} fill="currentColor" /> : <Mic size={52} strokeWidth={2.2} />}
                </button>
                {recording && (
                  <svg aria-hidden className="pointer-events-none absolute size-40 -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="48"
                      fill="none"
                      stroke="#ff7a59"
                      strokeWidth="2"
                      strokeDasharray={301.6}
                      strokeDashoffset={301.6 * (recorder.seconds / MAX_SECONDS)}
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </div>
            )}

            {recording && (
              <button
                onClick={recorder.cancel}
                className="text-sm text-muted mt-8 flex items-center gap-1.5 rounded-full px-4 py-2 font-medium active:bg-surface-2"
              >
                <X size={16} /> Cancel
              </button>
            )}

            {recorder.error && !recording && (
              <p role="alert" className="text-sm mt-8 max-w-xs text-center text-[#d13a2f] dark:text-[#ff8f80]">
                {recorder.error}
              </p>
            )}
          </>
        )}
      </div>

      {!recording && !thinking && (
        <div className="pb-4">
          {files.length > 0 && (
            <div className="mb-2">
              <AttachmentStrip items={files} onRemove={removeFile} onAdd={picker.open} />
            </div>
          )}
          {typing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) run(text.trim());
              }}
              className="border-line bg-surface shadow-sm focus-within:border-coral flex items-end gap-1 rounded-3xl border p-2"
            >
              <AttachButton compact count={files.length} onClick={picker.open} />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={Math.min(5, Math.max(1, Math.ceil(text.length / 34)))}
                placeholder="e.g. Mayank: receipt logo is cut off, urgent"
                className="placeholder:text-muted/70 max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 leading-snug outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && text.trim()) {
                    e.preventDefault();
                    run(text.trim());
                  }
                }}
              />
              <button
                type="submit"
                disabled={!text.trim()}
                aria-label="Write the ticket"
                className="bg-coral text-ink flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
              >
                <ArrowUp size={22} />
              </button>
            </form>
          ) : null}
          <div className="mt-3 flex items-center justify-center gap-1">
            {!typing && !files.length && <AttachButton count={files.length} onClick={picker.open} />}
            {props.ctx.voice && canRecord() && (
              <button
                onClick={() => {
                  recorder.setError("");
                  setTyping((t) => !t);
                }}
                className="text-sm text-muted flex items-center gap-2 rounded-full px-4 py-2 font-medium active:bg-surface-2"
              >
                {typing ? <Mic size={16} /> : <Keyboard size={16} />}
                {typing ? "Speak instead" : "Type instead"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Thinking({ heard }: { heard: string }) {
  return (
    <div className="fade-in w-full max-w-sm" aria-live="polite">
      <p className="mb-5 text-center text-[15px] font-medium">{heard ? "Writing your ticket…" : "Listening back…"}</p>
      <div className="border-line bg-surface space-y-3 rounded-2xl border p-4">
        <div className="shimmer h-5 w-4/5 rounded" />
        <div className="shimmer h-3.5 w-full rounded" />
        <div className="shimmer h-3.5 w-2/3 rounded" />
        <div className="flex gap-2 pt-1">
          <div className="shimmer h-7 w-24 rounded-full" />
          <div className="shimmer h-7 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}
