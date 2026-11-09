import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { WorkRunFailure } from "@t3tools/client-runtime/work/shelf";
import {
  checkLinkLabel,
  noteDisplay,
  notesSummary,
  sortNotes,
  workChatEntries,
  type NoteCheckTarget,
} from "@t3tools/client-runtime/work/notes";
import {
  noteAnchorChip,
  noteAuthorLabel,
  plainPreview,
} from "@t3tools/client-runtime/work/anchors";
import type {
  Deliverable,
  DeliverableNote,
  DeliverableVersion,
  DeliverableVersionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { describeAnchor } from "@t3tools/shared/deliverableNotes";
import * as DateTime from "effect/DateTime";
import {
  CircleAlertIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { cn } from "../../lib/utils";
import { TextFieldSpeechControls, type TextFieldSpeech } from "../../speech/useTextFieldSpeech";
import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { RelativeTime } from "../RelativeTime";
import { PendingRequestCards } from "../chat/PendingRequestCards";
import { SpendApprovalCard, type SpendApprovalItem } from "../chat/SpendApprovalCard";
import { Button, ContentButton, InlineButton } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { StatusDot } from "../ui/status-dot";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { Drawing } from "./DrawOverlay";
import { isThreadBusy, useThreadMessages, useWorkAssetUrl } from "./useWorkData";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { WorkThreadChat } from "./WorkThreadChat";
import { NoteStatusTag, noteStatusDotClass, noteStatusTone } from "./WorkStatusChip";

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
  /** Notes on every deliverable: the messages that sent them show as note cards, not chat. */
  readonly projectNotes: ReadonlyArray<DeliverableNote>;
  readonly versions: ReadonlyArray<DeliverableVersion>;
  readonly thread: EnvironmentThreadShell | null;
  /** How the agent's last run ended early, and the notes it left unfixed. */
  readonly failure: WorkRunFailure | null;
  readonly failedNotes: ReadonlyArray<DeliverableNote>;
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
  const noteMessageIds = new Set(
    props.projectNotes.flatMap((note) => (note.sentMessageId === null ? [] : [note.sentMessageId])),
  );
  const unsent = props.notes.filter(
    (note) => note.status === "open" && note.sentMessageId === null,
  );
  const tabs: ReadonlyArray<{ readonly id: NotesTab; readonly label: ReactNode }> = [
    {
      id: "notes",
      label:
        props.notes.length === 0 ? (
          "Notes & chat"
        ) : (
          <>
            Notes & chat
            <span className="text-dim-foreground tabular-nums">{props.notes.length}</span>
          </>
        ),
    },
    { id: "changes", label: "What changed" },
    { id: "chat", label: "Full chat" },
  ];
  return (
    <aside
      aria-label="Notes and chat"
      className="flex min-h-0 w-full flex-col border-t border-border bg-card lg:w-[24rem] lg:shrink-0 lg:border-t-0 lg:border-l"
    >
      <nav aria-label="Panel" className="flex shrink-0 px-3 pt-3">
        <ToggleGroup
          className="w-full"
          size="segmented-wide"
          variant="segmented"
          value={[props.tab]}
          onValueChange={(next) => {
            const tab = tabs.find((candidate) => candidate.id === next[0]);
            if (tab) props.onTab(tab.id);
          }}
        >
          {tabs.map((tab) => (
            <Toggle key={tab.id} value={tab.id}>
              {tab.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </nav>
      {props.tab === "chat" ? (
        <div className="min-h-0 flex-1">
          {props.thread === null ? (
            <p className="p-4 text-body text-muted-foreground">
              The conversation starts with your first note.
            </p>
          ) : (
            <WorkThreadChat environmentId={props.environmentId} threadId={props.thread.id} />
          )}
        </div>
      ) : props.tab === "changes" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{props.changes}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {summary.length > 0 ? (
            <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
              <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-border">
                {summary.map((segment) => (
                  <span
                    key={segment.status}
                    className={noteStatusDotClass(segment.status)}
                    style={{ flexGrow: segment.count }}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
                {summary.map((segment) => (
                  <li key={segment.status} className="inline-flex items-center gap-1.5">
                    <StatusDot tone={noteStatusTone(segment.status)} />
                    {segment.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {props.thread === null ? null : (
              <PendingRequestCards
                environmentId={props.environmentId}
                threadId={props.thread.id}
                onOpenFull={() => props.onTab("chat")}
              />
            )}
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
                variant="secondary"
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
              <p className="py-6 text-center text-body text-muted-foreground">
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
                failure={props.failedNotes.includes(note) ? props.failure : null}
                canOperate={props.canOperate}
                sending={props.sending}
                onSend={() => props.onSendNotes([note])}
                onCheck={props.onCheck}
                onFocus={() => props.onFocusNote(note)}
              />
            ))}
            {props.thread === null ? null : (
              <WorkChatLog
                environmentId={props.environmentId}
                thread={props.thread}
                noteMessageIds={noteMessageIds}
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
        "flex size-6 shrink-0 items-center justify-center rounded-full text-caption",
        agent ? "bg-primary text-primary-foreground" : "surface-raised text-foreground",
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
  /** Set when the run working on this note stopped before fixing it. */
  readonly failure: WorkRunFailure | null;
  readonly canOperate: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onCheck: (check: NoteCheckTarget) => void;
  readonly onFocus: () => void;
}) {
  const { note, display } = props;
  const setStatus = useAtomCommand(workEnvironment.setNoteStatus, "update note");
  const remove = useAtomCommand(workEnvironment.deleteNote, "delete note");
  const author = noteAuthorLabel(note.author);
  const chip = noteAnchorChip(note.anchor, props.kind);
  const target = { environmentId: props.environmentId, input: { noteId: note.id } };
  return (
    <article
      aria-label={`${author}: ${note.body}`}
      className={cn(
        "flex flex-col gap-2 rounded-card surface-card p-3",
        note.status === "resolved" && "opacity-70",
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar>{author.slice(0, 1).toUpperCase()}</Avatar>
        <span className="min-w-0 truncate text-meta text-foreground">{author}</span>
        <span className="shrink-0 text-caption text-muted-foreground">
          <RelativeTime timestamp={DateTime.formatIso(note.createdAt)} />
        </span>
        <span className="flex-1" />
        <Button
          size="chip"
          variant="secondary"
          className="shrink-0"
          onClick={props.onFocus}
          aria-label={`Go to ${describeAnchor(note.anchor, props.kind)}`}
        >
          <span className="font-mono">{chip}</span>
        </Button>
        <NoteStatusTag status={display.status}>{display.label}</NoteStatusTag>
      </header>
      <p className="text-body whitespace-pre-wrap text-foreground">{note.body}</p>
      {note.snapshotUrl !== null ? (
        <ContentButton
          variant="panel"
          className="self-start"
          onClick={props.onFocus}
          aria-label="Show where this note points"
        >
          <NoteSnapshot environmentId={props.environmentId} url={note.snapshotUrl} />
        </ContentButton>
      ) : null}
      {props.failure !== null ? (
        <p className="flex min-w-0 items-start gap-1.5 text-meta text-foreground">
          <CircleAlertIcon
            className="mt-px size-3.5 shrink-0 text-warning-foreground"
            aria-hidden
          />
          <span>
            <span className="text-strong-foreground">{props.failure.title}.</span> The agent stopped
            before fixing this.
          </span>
        </p>
      ) : null}
      {note.reply !== null || display.status === "fixing" ? (
        <div className="flex min-w-0 gap-2 rounded-lg bg-secondary p-2">
          <Avatar agent>
            <SparklesIcon className="size-3" />
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="line-clamp-2 text-meta text-foreground">
              {note.reply ??
                (note.sentRunId === null ? "Sent. Waiting for the agent…" : "Working on it…")}
            </p>
            {display.check !== null ? (
              <p className="text-meta">
                <InlineButton onClick={() => props.onCheck(display.check!)}>
                  {checkLinkLabel(display.check)}
                </InlineButton>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {props.canOperate ? (
        <footer className="flex flex-wrap items-center gap-1">
          {note.status === "open" ? (
            <Button size="xs" variant="secondary" disabled={props.sending} onClick={props.onSend}>
              {props.failure !== null ? <RotateCcwIcon /> : <SendIcon />}
              {props.failure !== null
                ? "Retry"
                : note.sentMessageId === null
                  ? "Send to agent"
                  : "Send again"}
            </Button>
          ) : null}
          {note.status === "fixed" ? (
            <>
              <Button
                size="xs"
                variant="default"
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

/** What was said outside notes, and each run's last reply, so a whole-deck ask reads as chat. */
function WorkChatLog(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly noteMessageIds: ReadonlySet<string>;
  readonly onOpenChat: () => void;
}) {
  const messages = useThreadMessages(scopeThreadRef(props.environmentId, props.thread.id));
  const entries = workChatEntries(messages, props.noteMessageIds);
  const working = isThreadBusy(props.thread);
  if (entries.length === 0 && !working) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2.5 px-1">
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-0 gap-2">
          {entry.role === "user" ? (
            <Avatar>Y</Avatar>
          ) : (
            <Avatar agent>
              <SparklesIcon className="size-3" />
            </Avatar>
          )}
          <p
            className={cn(
              "min-w-0 text-body whitespace-pre-line",
              entry.role === "user"
                ? "line-clamp-3 text-foreground"
                : "line-clamp-4 text-muted-foreground",
            )}
          >
            {/* A plain preview: markdown emphasis and code marks would show as stray characters. */}
            {entry.role === "user" ? entry.text : plainPreview(entry.text)}
          </p>
        </div>
      ))}
      {working ? (
        <div className="flex min-w-0 gap-2">
          <Avatar agent>
            <SparklesIcon className="size-3" />
          </Avatar>
          <p className="text-meta text-muted-foreground">Working…</p>
        </div>
      ) : null}
      <Button variant="link" size="micro" className="self-start" onClick={props.onOpenChat}>
        Open the full chat
      </Button>
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
      className="flex shrink-0 flex-col gap-2 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) props.onSend();
      }}
    >
      {composer.drawing !== null ? (
        <div className="flex items-center gap-2 text-meta text-foreground">
          <Badge variant="secondary" size="lg">
            Drawing attached
          </Badge>
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
          variant="default"
          aria-label="Send note"
          disabled={!canSend}
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}
