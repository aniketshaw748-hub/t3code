import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  checkLinkLabel,
  noteDisplay,
  notesSummary,
  sortNotes,
  type NoteCheckTarget,
} from "@t3tools/client-runtime/work/notes";
import type {
  Deliverable,
  DeliverableNote,
  DeliverableVersion,
  DeliverableVersionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { describeAnchor, formatTimecode } from "@t3tools/shared/deliverableNotes";
import * as DateTime from "effect/DateTime";
import { SendIcon, SparklesIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { cn } from "../../lib/utils";
import { TextFieldSpeechControls, type TextFieldSpeech } from "../../speech/useTextFieldSpeech";
import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { RelativeTime } from "../RelativeTime";
import { SpendApprovalCard, type SpendApprovalItem } from "../chat/SpendApprovalCard";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { Drawing } from "./DrawOverlay";
import { isThreadBusy, useLatestAgentText, useWorkAssetUrl } from "./useWorkData";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { WorkThreadChat } from "./WorkThreadChat";
import { NoteStatusTag, noteStatusDotClass } from "./WorkStatusChip";

export type NotesTab = "notes" | "changes" | "chat";

export interface NoteComposerState {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly speech: TextFieldSpeech;
  /** Pin to the playhead or selected slide, or speak about the whole deliverable. */
  readonly pinned: boolean;
  readonly setPinned: (pinned: boolean) => void;
  readonly drawing: Drawing | null;
  readonly clearDrawing: () => void;
}

/**
 * Notes & chat: every note is a small thread with the agent, tracked open → agent fixing →
 * fixed in Vn → resolved, with the agent's short reply and a link to check the fix.
 */
export function NotesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly deliverable: Deliverable | null;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly versions: ReadonlyArray<DeliverableVersion>;
  readonly thread: EnvironmentThreadShell | null;
  readonly spendApprovals: ReadonlyArray<SpendApprovalItem>;
  /** What a pinned note would point at right now: `0:42`, `Slide 3`, or null when nothing is. */
  readonly pinLabel: string | null;
  readonly composer: NoteComposerState;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly sending: boolean;
  readonly canOperate: boolean;
  readonly changes: ReactNode;
  readonly tab: NotesTab;
  readonly onTab: (tab: NotesTab) => void;
  readonly onSend: () => void;
  readonly onSendNotes: (notes: ReadonlyArray<DeliverableNote>) => void;
  readonly onCheck: (check: NoteCheckTarget) => void;
  readonly onFocusNote: (note: DeliverableNote) => void;
}) {
  const ordinalById = new Map(props.versions.map((version) => [version.id, version.ordinal]));
  const ordinalOf = (versionId: DeliverableVersionId) => ordinalById.get(versionId);
  const sorted = sortNotes(props.notes);
  const summary = notesSummary(props.notes);
  const unsent = props.notes.filter(
    (note) => note.status === "open" && note.sentMessageId === null,
  );
  const tabs: ReadonlyArray<{ readonly id: NotesTab; readonly label: string }> = [
    {
      id: "notes",
      label: props.notes.length === 0 ? "Notes & chat" : `Notes & chat · ${props.notes.length}`,
    },
    { id: "changes", label: "What changed" },
    { id: "chat", label: "Full chat" },
  ];
  return (
    <aside
      aria-label="Notes and chat"
      className="flex min-h-0 w-full flex-col border-t border-work-line bg-work-panel lg:w-[24rem] lg:shrink-0 lg:border-t-0 lg:border-l"
    >
      <div role="tablist" aria-label="Panel" className="flex shrink-0 items-center gap-1 px-3 pt-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.tab === tab.id}
            onClick={() => props.onTab(tab.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight",
              props.tab === tab.id
                ? "bg-work-raised text-work-ink"
                : "text-work-muted hover:text-work-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {props.tab === "chat" ? (
        <div role="tabpanel" className="min-h-0 flex-1">
          {props.thread === null ? (
            <p className="p-4 text-sm text-work-muted">
              The conversation starts with your first note.
            </p>
          ) : (
            <WorkThreadChat environmentId={props.environmentId} threadId={props.thread.id} />
          )}
        </div>
      ) : props.tab === "changes" ? (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
          {props.changes}
        </div>
      ) : (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          {summary.length > 0 ? (
            <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
              <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-work-line">
                {summary.map((segment) => (
                  <span
                    key={segment.status}
                    className={noteStatusDotClass(segment.status)}
                    style={{ flexGrow: segment.count }}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-work-muted">
                {summary.map((segment) => (
                  <li key={segment.status} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", noteStatusDotClass(segment.status))}
                    />
                    {segment.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {props.spendApprovals.map((item) => (
              <SpendApprovalCard
                key={item.id}
                environmentId={props.environmentId}
                item={item}
                visibility="local"
              />
            ))}
            {unsent.length > 1 && props.canOperate ? (
              <Button
                variant="outline"
                size="xs"
                className="self-start"
                disabled={props.sending}
                onClick={() => props.onSendNotes(unsent)}
              >
                <SendIcon />
                Send {unsent.length} open notes to the agent
              </Button>
            ) : null}
            {sorted.length === 0 && props.spendApprovals.length === 0 && props.thread === null ? (
              <p className="py-6 text-center text-sm text-work-muted">
                Leave a note: type below, talk, or draw on the frame. It pins to the moment you are
                on.
              </p>
            ) : null}
            {sorted.map((note) => (
              <NoteCard
                key={note.id}
                environmentId={props.environmentId}
                note={note}
                kind={props.deliverable?.kind ?? "other"}
                display={noteDisplay(note, ordinalOf)}
                canOperate={props.canOperate}
                sending={props.sending}
                onSend={() => props.onSendNotes([note])}
                onCheck={props.onCheck}
                onFocus={() => props.onFocusNote(note)}
              />
            ))}
            {props.thread === null ? null : (
              <AgentLine
                environmentId={props.environmentId}
                thread={props.thread}
                onOpenChat={() => props.onTab("chat")}
              />
            )}
          </div>
          <NoteComposer
            environmentId={props.environmentId}
            kind={props.deliverable?.kind ?? "other"}
            hasWork={props.deliverable !== null}
            disabled={!props.canOperate}
            pinLabel={props.pinLabel}
            composer={props.composer}
            textareaRef={props.composerRef}
            sending={props.sending}
            onSend={props.onSend}
          />
        </div>
      )}
    </aside>
  );
}

function Avatar({
  children,
  agent = false,
}: {
  readonly children: ReactNode;
  readonly agent?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
        agent
          ? "bg-work-highlight text-work-highlight-ink"
          : "bg-work-raised text-work-ink ring-1 ring-work-line",
      )}
    >
      {children}
    </span>
  );
}

function NoteCard(props: {
  readonly environmentId: EnvironmentId;
  readonly note: DeliverableNote;
  readonly kind: Deliverable["kind"];
  readonly display: ReturnType<typeof noteDisplay>;
  readonly canOperate: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onCheck: (check: NoteCheckTarget) => void;
  readonly onFocus: () => void;
}) {
  const { note, display } = props;
  const setStatus = useAtomCommand(workEnvironment.setNoteStatus, "update note");
  const remove = useAtomCommand(workEnvironment.deleteNote, "delete note");
  const author =
    note.author.kind === "external"
      ? (note.author.name ?? note.author.source ?? "Reviewer")
      : "You";
  const chip =
    note.anchor === null
      ? props.kind === "deck"
        ? "Whole deck"
        : props.kind === "video"
          ? "Whole video"
          : "Whole file"
      : note.anchor.kind === "time"
        ? formatTimecode(note.anchor.t)
        : note.anchor.kind === "slide"
          ? `Slide ${note.anchor.index + 1}`
          : "Area";
  const target = { environmentId: props.environmentId, input: { noteId: note.id } };
  return (
    <article
      aria-label={`${author}: ${note.body}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-work-line bg-work-canvas/60 p-3",
        note.status === "resolved" && "opacity-70",
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar>{author.slice(0, 1).toUpperCase()}</Avatar>
        <span className="min-w-0 truncate text-xs font-medium text-work-ink">{author}</span>
        <span className="shrink-0 text-2xs text-work-muted">
          <RelativeTime timestamp={DateTime.formatIso(note.createdAt)} />
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={props.onFocus}
          aria-label={`Go to ${describeAnchor(note.anchor, props.kind)}`}
          className="shrink-0 rounded-md bg-work-raised px-1.5 py-0.5 font-mono text-2xs text-work-ink outline-hidden ring-1 ring-work-line hover:bg-work-line focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight"
        >
          {chip}
        </button>
        <NoteStatusTag status={display.status}>{display.label}</NoteStatusTag>
      </header>
      <p className="text-sm whitespace-pre-wrap text-work-ink">{note.body}</p>
      {note.snapshotUrl !== null ? (
        <button
          type="button"
          onClick={props.onFocus}
          className="self-start overflow-hidden rounded-md ring-1 ring-work-line outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight"
          aria-label="Show where this note points"
        >
          <NoteSnapshot environmentId={props.environmentId} url={note.snapshotUrl} />
        </button>
      ) : null}
      {note.reply !== null || display.status === "fixing" ? (
        <div className="flex min-w-0 gap-2 rounded-lg bg-work-raised p-2">
          <Avatar agent>
            <SparklesIcon className="size-3" />
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="line-clamp-2 text-xs text-work-ink">
              {note.reply ??
                (note.sentRunId === null ? "Sent. Waiting for the agent…" : "Working on it…")}
            </p>
            {display.check !== null ? (
              <button
                type="button"
                onClick={() => props.onCheck(display.check!)}
                className="self-start text-xs font-medium text-work-ink underline underline-offset-2 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight"
              >
                {checkLinkLabel(display.check)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {props.canOperate ? (
        <footer className="flex flex-wrap items-center gap-1">
          {note.status === "open" ? (
            <Button size="xs" variant="outline" disabled={props.sending} onClick={props.onSend}>
              <SendIcon />
              {note.sentMessageId === null ? "Send to agent" : "Send again"}
            </Button>
          ) : null}
          {note.status === "fixed" ? (
            <>
              <Button
                size="xs"
                variant="contrast"
                onClick={() =>
                  void setStatus({ ...target, input: { noteId: note.id, status: "resolved" } })
                }
              >
                Looks good
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void setStatus({ ...target, input: { noteId: note.id, status: "open" } })
                }
              >
                Still not right
              </Button>
            </>
          ) : null}
          {note.status === "resolved" ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void setStatus({ ...target, input: { noteId: note.id, status: "open" } })
              }
            >
              Reopen
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            size="icon-xs"
            variant="ghost-destructive"
            aria-label="Delete note"
            onClick={() => void remove(target)}
          >
            <Trash2Icon />
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

function NoteSnapshot(props: { readonly environmentId: EnvironmentId; readonly url: string }) {
  const src = useWorkAssetUrl(props.environmentId)(props.url);
  return src === null ? null : (
    <img src={src} alt="" loading="lazy" className="h-20 w-auto max-w-56 object-cover" />
  );
}

function AgentLine(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly onOpenChat: () => void;
}) {
  const latest = useLatestAgentText(scopeThreadRef(props.environmentId, props.thread.id));
  const working = isThreadBusy(props.thread);
  if (latest === null && !working) return null;
  // A plain preview: markdown emphasis and code marks would show as stray characters.
  const text = (latest ?? "").replace(/[*_`#>]+/g, "").trim();
  return (
    <div className="flex min-w-0 gap-2 px-1">
      <Avatar agent>
        <SparklesIcon className="size-3" />
      </Avatar>
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p className="line-clamp-4 text-xs whitespace-pre-line text-work-muted">
          {working ? (text.length === 0 ? "Working…" : "Working · ") : ""}
          {text}
        </p>
        <Button variant="link" size="micro" onClick={props.onOpenChat}>
          Open the full chat
        </Button>
      </div>
    </div>
  );
}

function NoteComposer({
  textareaRef,
  ...props
}: {
  readonly environmentId: EnvironmentId;
  readonly kind: Deliverable["kind"];
  readonly hasWork: boolean;
  readonly disabled: boolean;
  readonly pinLabel: string | null;
  readonly composer: NoteComposerState;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly sending: boolean;
  readonly onSend: () => void;
}) {
  const { composer } = props;
  const [focused, setFocused] = useState(false);
  const noun = props.kind === "deck" ? "deck" : props.kind === "video" ? "video" : "file";
  const whole = `Whole ${noun}`;
  const pinned = composer.pinned && props.pinLabel !== null;
  const canSend =
    !props.disabled &&
    !props.sending &&
    composer.text.trim().length > 0 &&
    !composer.speech.blocksSubmission;
  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-work-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) props.onSend();
      }}
    >
      {composer.drawing !== null ? (
        <div className="flex items-center gap-2 text-xs text-work-ink">
          <span className="inline-flex items-center gap-1 rounded-full bg-work-raised px-2 py-0.5 ring-1 ring-work-line">
            Drawing attached
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Remove drawing"
            onClick={composer.clearDrawing}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        size="sm"
        rows={focused || composer.text.length > 0 ? 3 : 2}
        disabled={props.disabled}
        placeholder={
          !props.hasWork
            ? "Tell the agent what to make"
            : pinned
              ? `Note at ${props.pinLabel}, or ask about the whole ${noun}`
              : `Ask for a change to the whole ${noun}`
        }
        value={composer.text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => composer.setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) props.onSend();
          }
        }}
        aria-label="Note for the agent"
      />
      <div className="flex min-w-0 items-center gap-2">
        {props.hasWork ? (
          <ToggleGroup
            aria-label="What the note is about"
            variant="segmented"
            value={[pinned ? "pinned" : "whole"]}
            onValueChange={(next) => composer.setPinned(next[0] === "pinned")}
          >
            <Toggle value="pinned" disabled={props.pinLabel === null}>
              {props.pinLabel === null ? "Here" : `At ${props.pinLabel}`}
            </Toggle>
            <Toggle value="whole">{whole}</Toggle>
          </ToggleGroup>
        ) : null}
        <span className="flex-1" />
        <TextFieldSpeechControls speech={composer.speech} disabled={props.disabled} />
        <Button
          type="submit"
          size="icon-xs"
          variant="contrast"
          aria-label="Send note"
          disabled={!canSend}
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}
