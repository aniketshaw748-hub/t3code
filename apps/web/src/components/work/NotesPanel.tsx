import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { noteAnchorChip, noteAuthorLabel } from "@t3tools/client-runtime/work/anchors";
import {
  checkLinkLabel,
  noteDisplay,
  notesSummary,
  sortNotes,
  workChatEntries,
  type NoteCheckTarget,
} from "@t3tools/client-runtime/work/notes";
import type { WorkRunFailure } from "@t3tools/client-runtime/work/shelf";
import type {
  Deliverable,
  DeliverableNote,
  DeliverableVersion,
  DeliverableVersionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { agentPreviewText } from "@t3tools/shared/agentPreviewText";
import { describeAnchor } from "@t3tools/shared/deliverableNotes";
import * as DateTime from "effect/DateTime";
import { CircleAlertIcon, RotateCcwIcon, SendIcon, Trash2Icon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { cn } from "../../lib/utils";
import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { RelativeTime } from "../RelativeTime";
import { PendingRequestCards } from "../chat/PendingRequestCards";
import { SpendApprovalCard, type SpendApprovalItem } from "../chat/SpendApprovalCard";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { NoteComposer, type NoteComposerState } from "./NoteComposer";
import { isThreadBusy, useThreadMessages, useWorkAssetUrl } from "./useWorkData";
import { AGENT_AUTHOR, AuthorLine, YOU_AUTHOR } from "./WorkAuthor";
import { NoteStatusLabel, noteStatusDotClass } from "./workStatus";
import { WorkThreadChat } from "./WorkThreadChat";

export type NotesTab = "notes" | "changes" | "chat";

const TABS: ReadonlyArray<{ readonly id: NotesTab; readonly label: string }> = [
  { id: "notes", label: "Notes & chat" },
  { id: "changes", label: "What changed" },
  { id: "chat", label: "Full chat" },
];

const isNotesTab = (value: unknown): value is NotesTab =>
  TABS.some((candidate) => candidate.id === value);

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
  return (
    <aside
      aria-label="Notes and chat"
      className="flex min-h-0 w-full flex-1 flex-col border-t border-border bg-background lg:w-[24rem] lg:flex-none lg:border-t-0 lg:border-l"
    >
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <ToggleGroup
          aria-label="Panel"
          variant="default"
          value={[props.tab]}
          onValueChange={(next) => {
            if (isNotesTab(next[0])) props.onTab(next[0]);
          }}
        >
          {TABS.map((tab) => (
            <Toggle key={tab.id} value={tab.id} variant="ghost" size="segmented">
              {tab.label}
              {tab.id === "notes" && props.notes.length > 0 ? (
                <Badge size="sm" variant="secondary">
                  {props.notes.length}
                </Badge>
              ) : null}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      {props.tab === "chat" ? (
        <div className="min-h-0 flex-1">
          {props.thread === null ? (
            <PanelEmpty title="No conversation yet">
              It starts with your first note or message.
            </PanelEmpty>
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
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {summary.map((segment) => (
                  <li key={segment.status} className="inline-flex">
                    <NoteStatusLabel status={segment.status}>{segment.label}</NoteStatusLabel>
                  </li>
                ))}
              </ul>
              <div aria-hidden className="flex h-1 gap-px overflow-hidden rounded-full bg-border">
                {summary.map((segment) => (
                  <span
                    key={segment.status}
                    className={noteStatusDotClass(segment.status)}
                    style={{ flexGrow: segment.count }}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
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
              <PanelEmpty title="No notes yet">
                Type below, talk, or draw on the frame. A note pins to the moment or slide you are
                on.
              </PanelEmpty>
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

function PanelEmpty(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Empty size="compact" className="min-h-0">
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
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
  const check = display.check;
  const target = { environmentId: props.environmentId, input: { noteId: note.id } };
  const reply =
    note.reply === null
      ? display.status === "fixing"
        ? note.sentRunId === null
          ? "Sent. Waiting for the agent…"
          : "Working on it…"
        : null
      : agentPreviewText(note.reply);
  return (
    <article
      aria-label={`${author}: ${note.body}`}
      className={cn(
        "flex shrink-0 flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-3",
        note.status === "resolved" && "opacity-70",
      )}
    >
      <AuthorLine
        author={{ kind: "person", name: author }}
        meta={<RelativeTime timestamp={DateTime.formatIso(note.createdAt)} />}
        trailing={
          <Badge
            variant="outline"
            className="font-mono"
            render={
              <button
                type="button"
                onClick={props.onFocus}
                aria-label={`Go to ${describeAnchor(note.anchor, props.kind)}`}
              />
            }
          >
            {noteAnchorChip(note.anchor, props.kind)}
          </Badge>
        }
      />
      <p className="text-sm wrap-anywhere whitespace-pre-wrap text-foreground">{note.body}</p>
      {note.snapshotUrl !== null ? (
        <button
          type="button"
          onClick={props.onFocus}
          className="cursor-pointer self-start overflow-hidden rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Show where this note points"
        >
          <NoteSnapshot environmentId={props.environmentId} url={note.snapshotUrl} />
        </button>
      ) : null}
      <NoteStatusLabel status={display.status}>{display.label}</NoteStatusLabel>
      {props.failure !== null ? (
        <p className="flex min-w-0 items-start gap-1.5 text-xs text-warning-foreground">
          <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium">{props.failure.title}.</span> The agent stopped before
            fixing this.
          </span>
        </p>
      ) : null}
      {reply !== null ? (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted p-2.5 text-xs">
          <AuthorLine
            author={AGENT_AUTHOR}
            trailing={
              note.reply === null ? <Spinner size="xs" tone="muted" aria-hidden /> : undefined
            }
          />
          <p className="line-clamp-3 wrap-anywhere whitespace-pre-line text-muted-foreground">
            {reply}
          </p>
          {check !== null ? (
            <InlineButton className="self-start" onClick={() => props.onCheck(check)}>
              {checkLinkLabel(check)}
            </InlineButton>
          ) : null}
        </div>
      ) : null}
      {props.canOperate ? (
        <footer className="flex flex-wrap items-center gap-1">
          {note.status === "open" ? (
            <Button size="xs" variant="outline" disabled={props.sending} onClick={props.onSend}>
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
                onClick={() =>
                  void setStatus({ ...target, input: { noteId: note.id, status: "resolved" } })
                }
              >
                Looks good
              </Button>
              <Button
                size="xs"
                variant="outline"
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
    <section aria-label="Chat" className="flex min-w-0 shrink-0 flex-col gap-3 px-1 pt-1">
      {entries.map((entry) => (
        <div key={entry.id} className="flex min-w-0 flex-col gap-1">
          <AuthorLine author={entry.role === "user" ? YOU_AUTHOR : AGENT_AUTHOR} />
          <p
            className={cn(
              "min-w-0 ps-7 text-xs wrap-anywhere whitespace-pre-line",
              entry.role === "user"
                ? "line-clamp-3 text-foreground"
                : "line-clamp-4 text-muted-foreground",
            )}
          >
            {entry.text}
          </p>
        </div>
      ))}
      {working ? (
        <AuthorLine
          author={AGENT_AUTHOR}
          meta={
            <span className="inline-flex items-center gap-1.5">
              <Spinner size="xs" aria-hidden />
              Working…
            </span>
          }
        />
      ) : null}
      <div className="ps-7 text-xs">
        <InlineButton tone="muted" onClick={props.onOpenChat}>
          Open the full chat
        </InlineButton>
      </div>
    </section>
  );
}
