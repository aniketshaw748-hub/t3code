import { scopeThreadRef, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ChatAttachment,
  DesktopBubbleThreadTarget,
  OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { workRunFailure, workRunFailureDetail } from "@t3tools/client-runtime/work/shelf";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useClientSettings } from "~/hooks/useSettings";
import { cn, newMessageId } from "~/lib/utils";
import {
  useProject,
  useQuietThreadShell,
  useQuietThreadVisibleTurnItems,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { isImageAttachment } from "~/types";
import ChatMarkdown from "../ChatMarkdown";
import { PendingRequestCards } from "../chat/PendingRequestCards";
import { AttachmentImage } from "../media/AttachmentImage";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon } from "../ui/input-group";
import { Textarea } from "../ui/textarea";
import { deriveThreadProgressReport } from "./bubbleProgress.logic";
import { ElapsedLabel } from "./BubbleThreadList";
import { buildCompactReply, type CompactReplyBlock } from "./compactReply.logic";

const MAX_MESSAGES = 12;
const scrollIntoView = (node: HTMLDivElement | null) => node?.scrollIntoView({ block: "end" });
const REPLY_TEXT_BUDGET = 900;
const USER_TEXT_MAX = 400;

type ChatMessageItem = Extract<
  OrchestrationV2ProjectedTurnItem["item"],
  { readonly type: "user_message" | "assistant_message" }
>;

function chatMessages(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<ChatMessageItem> {
  const messages: ChatMessageItem[] = [];
  for (const { item } of items) {
    if (item.type !== "user_message" && item.type !== "assistant_message") continue;
    if (item.text.trim().length === 0 && (item.attachments?.length ?? 0) === 0) continue;
    messages.push(item);
  }
  return messages.slice(-MAX_MESSAGES);
}

function AttachmentThumb({
  attachment,
  target,
}: {
  readonly attachment: ChatAttachment;
  readonly target: DesktopBubbleThreadTarget;
}) {
  const image = isImageAttachment(attachment) ? attachment : null;
  const url = useAssetUrlState(
    target.environmentId,
    image === null
      ? null
      : {
          _tag: "attachment",
          attachmentId: image.id,
          fileName: image.name,
          mimeType: image.mimeType,
          disposition: "inline",
        },
  );
  if (image === null) {
    return (
      <span className="max-w-full truncate rounded-md border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
        {attachment.name}
      </span>
    );
  }
  return url._tag === "Success" ? (
    <AttachmentImage
      name={image.name}
      mimeType={image.mimeType}
      src={url.url}
      alt={image.name}
      decoding="async"
      className="size-14 rounded-md border border-border object-cover"
    />
  ) : (
    <span className="size-14 rounded-md border border-border bg-muted" aria-label={image.name} />
  );
}

function CodeBlock({ block }: { readonly block: Extract<CompactReplyBlock, { kind: "code" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-muted/40">
      {/* A disclosure row, not a button a primitive provides. */}
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-2 py-1 text-2xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="font-mono">{block.language ?? "code"}</span>
        <span>
          · {block.lineCount} {block.lineCount === 1 ? "line" : "lines"}
        </span>
      </button>
      {open ? (
        <pre className="max-h-48 overflow-auto border-t border-border/70 px-2 py-1.5 font-mono text-2xs leading-4">
          {block.code}
        </pre>
      ) : null}
    </div>
  );
}

function AssistantReply(props: {
  readonly text: string;
  readonly cwd: string | undefined;
  readonly target: DesktopBubbleThreadTarget;
  readonly onOpenFull: () => void;
}) {
  const reply = buildCompactReply(props.text, REPLY_TEXT_BUDGET);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs [&_img]:max-h-24 [&_img]:rounded-md">
      {reply.blocks.map((block) =>
        block.kind === "code" ? (
          <CodeBlock key={block.id} block={block} />
        ) : (
          <ChatMarkdown
            key={block.id}
            className="text-xs leading-5"
            text={block.markdown}
            cwd={props.cwd}
            environmentId={props.target.environmentId}
            threadRef={scopeThreadRef(props.target.environmentId, props.target.threadId)}
          />
        ),
      )}
      {reply.truncated ? (
        <Button variant="link" size="micro" className="self-start" onClick={props.onOpenFull}>
          Read the rest in the full thread
        </Button>
      ) : null}
    </div>
  );
}

/** A small chat with one thread: its latest replies, what runs now, and a box to answer. */
export function BubbleChat(props: {
  readonly target: DesktopBubbleThreadTarget;
  readonly onClose: () => void;
  readonly onOpenFull: () => void;
}) {
  const ref = scopeThreadRef(props.target.environmentId, props.target.threadId);
  const shell = useQuietThreadShell(ref);
  const project = useProject(
    shell === null ? null : scopeProjectRef(props.target.environmentId, shell.projectId),
  );
  const items = useThreadVisibleTurnItems(ref);
  const quietItems = useQuietThreadVisibleTurnItems(ref);
  const followUpBehavior = useClientSettings((settings) => settings.followUpBehavior);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messages = chatMessages(items);
  const report = deriveThreadProgressReport(quietItems);
  const running = threadRuntimeIsActive(shell?.runtime);
  const workingSince = shell === null ? null : resolveThreadWorkingStartedAt(shell);
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? undefined;
  const lastMessage = messages.at(-1);
  const scrollKey = `${messages.length}:${lastMessage?.text.length ?? 0}:${report.current ?? ""}`;

  const failure = running ? null : workRunFailure(shell?.source);
  const lastRequest = messages.findLast((message) => message.type === "user_message")?.text.trim();

  const send = async (retryText?: string) => {
    const text = retryText ?? draft.trim();
    if (text.length === 0 || shell === null || sending) return;
    setSending(true);
    setSendError(null);
    const result = await startTurn({
      environmentId: props.target.environmentId,
      input: {
        threadId: props.target.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        dispatchMode: resolveComposerDispatchMode({
          running,
          alternateModifier: false,
          activeTurnDefault: followUpBehavior,
        }),
        createdAt: new Date().toISOString(),
      },
    });
    setSending(false);
    if (result._tag === "Success") {
      if (retryText === undefined) setDraft("");
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setSendError(failure instanceof Error ? failure.message : "Could not send the message.");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/70 ps-3 pe-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {shell?.title ?? "Thread"}
          </p>
          {project ? (
            <p className="truncate text-2xs text-muted-foreground">{project.title}</p>
          ) : null}
        </div>
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="Open the full thread"
          onClick={props.onOpenFull}
        >
          <ExternalLinkIcon />
        </Button>
        <Button
          variant="ghost-muted"
          size="icon-xs"
          aria-label="Close chat"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {shell === null ? (
          <p className="text-xs text-muted-foreground">This thread is no longer available.</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading the latest replies…</p>
        ) : null}
        {messages.map((message) =>
          message.type === "user_message" ? (
            <div key={message.id} className="flex flex-col items-end gap-1">
              {message.text.trim().length > 0 ? (
                <p className="max-w-[85%] rounded-2xl bg-message px-2.5 py-1.5 text-xs wrap-anywhere whitespace-pre-wrap text-message-foreground">
                  {message.text.length > USER_TEXT_MAX
                    ? `${message.text.slice(0, USER_TEXT_MAX).trimEnd()}…`
                    : message.text}
                </p>
              ) : null}
              {message.attachments.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {message.attachments.map((attachment) => (
                    <AttachmentThumb
                      key={attachment.id}
                      attachment={attachment}
                      target={props.target}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div key={message.id} className="flex flex-col gap-1">
              <AssistantReply
                text={message.text}
                cwd={cwd}
                target={props.target}
                onOpenFull={props.onOpenFull}
              />
              {(message.attachments?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {message.attachments?.map((attachment) => (
                    <AttachmentThumb
                      key={attachment.id}
                      attachment={attachment}
                      target={props.target}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}
        <PendingRequestCards
          environmentId={props.target.environmentId}
          threadId={props.target.threadId}
          onOpenFull={props.onOpenFull}
        />
        {running ? (
          <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 truncate">{report.current ?? "Working"}</span>
            {workingSince ? (
              <span className="shrink-0 opacity-70">
                · <ElapsedLabel since={workingSince} />
              </span>
            ) : null}
          </p>
        ) : null}
        {failure !== null ? (
          <div role="alert" className="flex min-w-0 items-start gap-1.5 text-2xs text-foreground">
            <CircleAlertIcon className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
            <p className="min-w-0 flex-1">
              <span className="font-medium">{failure.title}.</span> {workRunFailureDetail(failure)}
            </p>
            {lastRequest ? (
              <Button
                size="xs"
                variant="outline"
                disabled={sending}
                onClick={() => void send(lastRequest)}
              >
                <RotateCcwIcon />
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* Remounts as the reply grows, keeping the newest line in view like a chat. */}
        <div key={scrollKey} ref={scrollIntoView} aria-hidden className="h-px shrink-0" />
      </div>
      <div className="flex shrink-0 flex-col gap-1 border-t border-border/70 p-2">
        {sendError ? <p className="px-1 text-2xs text-destructive">{sendError}</p> : null}
        <InputGroup>
          <Textarea
            size="sm"
            aria-label="Message"
            placeholder={running ? "Steer or queue a message…" : "Reply…"}
            value={draft}
            disabled={shell === null}
            // The chat opens on a click, so the window is already focused.
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <Button
              size="icon-sm"
              aria-label="Send"
              disabled={draft.trim().length === 0 || sending || shell === null}
              onClick={() => void send()}
            >
              <ArrowUpIcon />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
