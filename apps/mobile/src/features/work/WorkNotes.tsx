import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  formatSpendAmount,
  noteAnchorChip,
  noteAuthorLabel,
  spendApprovalDetails,
  type SpendApprovalTurnItem,
} from "@t3tools/client-runtime/work/anchors";
import {
  checkLinkLabel,
  notesSummary,
  type NoteCheckTarget,
  type NoteDisplay,
} from "@t3tools/client-runtime/work/notes";
import type { DeliverableKind, DeliverableNote, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describeAnchor } from "@t3tools/shared/deliverableNotes";
import * as DateTime from "effect/DateTime";
import { Image } from "expo-image";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import { isThreadBusy, useLatestAgentText, useWorkAssetUrl } from "./useWorkData";
import { NoteStatusTag, StatusDot, useNoteStatusColors } from "./WorkStatus";

/** A segmented bar of note statuses over their counts, in the order the user acts on them. */
export function NotesSummary(props: { readonly notes: ReadonlyArray<DeliverableNote> }) {
  const colors = useNoteStatusColors();
  const summary = notesSummary(props.notes);
  if (summary.length === 0) return null;
  return (
    <View className="gap-2">
      <View className="h-1.5 flex-row gap-0.5 overflow-hidden rounded-full">
        {summary.map((segment) => (
          <View
            key={segment.status}
            style={{ flexGrow: segment.count, backgroundColor: colors[segment.status] }}
          />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {summary.map((segment) => (
          <View key={segment.status} className="flex-row items-center gap-1.5">
            <StatusDot color={colors[segment.status]} />
            <Text className="text-2xs text-foreground-muted">{segment.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Avatar(props: { readonly label?: string; readonly agent?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        "size-6 items-center justify-center rounded-full",
        props.agent ? "bg-foreground" : "border border-border bg-subtle",
      )}
    >
      {props.agent ? (
        <SymbolView name="sparkles" size={12} tintColorClassName="accent-screen" />
      ) : (
        <Text className="text-3xs font-t3-bold">{props.label}</Text>
      )}
    </View>
  );
}

function SmallButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "contrast" | "outline" | "ghost";
  readonly disabled?: boolean;
  readonly icon?: "arrow.up" | "trash" | "checkmark";
  readonly accessibilityLabel?: string;
}) {
  const tone = props.tone ?? "outline";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={4}
      className={cn(
        "min-h-9 flex-row items-center gap-1.5 rounded-full px-3.5 active:opacity-70",
        tone === "contrast" && "bg-foreground",
        tone === "outline" && "border border-border",
        props.disabled && "opacity-40",
      )}
    >
      {props.icon ? (
        <SymbolView
          name={props.icon}
          size={14}
          tintColorClassName={tone === "contrast" ? "accent-screen" : "accent-icon"}
        />
      ) : null}
      {props.label.length > 0 ? (
        <Text
          className={cn(
            "text-xs font-t3-medium",
            tone === "contrast" ? "text-screen" : "text-foreground",
          )}
        >
          {props.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * One note as a small thread with the agent: the note, its timecode chip and status, the
 * agent's compact reply with a link that seeks to the fix, and the actions its status allows.
 */
export function NoteCard(props: {
  readonly environmentId: EnvironmentId;
  readonly note: DeliverableNote;
  readonly kind: DeliverableKind;
  readonly display: NoteDisplay;
  readonly highlighted: boolean;
  readonly canOperate: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onCheck: (check: NoteCheckTarget) => void;
  readonly onFocus: () => void;
}) {
  const { note, display } = props;
  const setStatus = useAtomCommand(workEnvironment.setNoteStatus, "update note");
  const remove = useAtomCommand(workEnvironment.deleteNote, "delete note");
  const assetUrl = useWorkAssetUrl(props.environmentId);
  const author = noteAuthorLabel(note.author);
  const setTo = (status: "open" | "resolved") =>
    void setStatus({ environmentId: props.environmentId, input: { noteId: note.id, status } });
  const snapshot = assetUrl(note.snapshotUrl);
  return (
    <View
      accessibilityLabel={`${author}: ${note.body}`}
      className={cn(
        "gap-2.5 rounded-2xl border bg-card p-3",
        props.highlighted ? "border-foreground" : "border-border",
        note.status === "resolved" && "opacity-70",
      )}
    >
      <View className="flex-row items-center gap-2">
        <Avatar label={author.slice(0, 1).toUpperCase()} />
        <Text numberOfLines={1} className="shrink text-xs font-t3-medium">
          {author}
        </Text>
        <Text className="text-2xs text-foreground-muted">
          <RelativeTime timestamp={DateTime.formatIso(note.createdAt)} />
        </Text>
        <View className="flex-1" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Go to ${describeAnchor(note.anchor, props.kind)}`}
          onPress={props.onFocus}
          hitSlop={6}
          className="rounded-md border border-border bg-subtle px-1.5 py-0.5 active:opacity-70"
        >
          <Text className="font-mono text-2xs">{noteAnchorChip(note.anchor, props.kind)}</Text>
        </Pressable>
      </View>
      <Text className="text-sm" selectable>
        {note.body}
      </Text>
      {snapshot === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show where this note points"
          onPress={props.onFocus}
          className="self-start overflow-hidden rounded-md border border-border"
        >
          <Image source={{ uri: snapshot }} contentFit="cover" style={{ width: 128, height: 72 }} />
        </Pressable>
      )}
      <View className="flex-row">
        <NoteStatusTag status={display.status} label={display.label} />
      </View>
      {note.reply !== null || display.status === "fixing" ? (
        <View className="flex-row gap-2 rounded-xl bg-subtle p-2.5">
          <Avatar agent />
          <View className="min-w-0 flex-1 gap-1">
            <Text numberOfLines={3} className="text-xs">
              {note.reply ??
                (note.sentRunId === null ? "Sent. Waiting for the agent…" : "Working on it…")}
            </Text>
            {display.check !== null ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => props.onCheck(display.check!)}
                hitSlop={6}
                className="self-start"
              >
                <Text className="text-xs font-t3-medium underline">
                  {checkLinkLabel(display.check)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {props.canOperate ? (
        <View className="flex-row flex-wrap items-center gap-2">
          {note.status === "open" ? (
            <SmallButton
              icon="arrow.up"
              label={note.sentMessageId === null ? "Send to agent" : "Send again"}
              disabled={props.sending}
              onPress={props.onSend}
            />
          ) : null}
          {note.status === "fixed" ? (
            <>
              <SmallButton tone="contrast" label="Looks good" onPress={() => setTo("resolved")} />
              <SmallButton tone="ghost" label="Still not right" onPress={() => setTo("open")} />
            </>
          ) : null}
          {note.status === "resolved" ? (
            <SmallButton tone="ghost" label="Reopen" onPress={() => setTo("open")} />
          ) : null}
          <View className="flex-1" />
          <SmallButton
            tone="ghost"
            icon="trash"
            label=""
            accessibilityLabel="Delete note"
            onPress={() =>
              void remove({ environmentId: props.environmentId, input: { noteId: note.id } })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/** The agent's latest words as a plain preview, with a way into the full chat. */
export function AgentLine(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly onOpenChat: () => void;
}) {
  const latest = useLatestAgentText(scopeThreadRef(props.environmentId, props.thread.id));
  const working = isThreadBusy(props.thread);
  if (latest === null && !working) return null;
  // Markdown marks would show as stray characters in a plain preview.
  const text = (latest ?? "").replace(/[*_`#>]+/g, "").trim();
  return (
    <View className="flex-row gap-2 px-1">
      <Avatar agent />
      <View className="min-w-0 flex-1 items-start gap-1">
        <Text numberOfLines={4} className="text-xs text-foreground-muted">
          {working ? (text.length === 0 ? "Working…" : "Working · ") : ""}
          {text}
        </Text>
        <Pressable accessibilityRole="button" onPress={props.onOpenChat} hitSlop={6}>
          <Text className="text-xs font-t3-medium underline">Open the full chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The agent's ask before a paid generation step, answered here with Approve or Decline. */
export function SpendApprovalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SpendApprovalTurnItem;
}) {
  const { item } = props;
  const answer = useAtomCommand(serverEnvironment.answerSpendApproval, {
    label: "answer spend approval",
    reportFailure: false,
  });
  const canAnswer = useAtomValue(
    serverEnvironment.answerSpendApproval.permissionAtom(props.environmentId),
  );
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two taps can land before a render.
  const inFlight = useRef(false);
  const send = async (decision: "approve" | "decline") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(decision);
    setError(null);
    const result = await answer({
      environmentId: props.environmentId,
      input: { threadId: item.threadId, turnItemId: item.id, decision },
    });
    inFlight.current = false;
    setPending(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not record the answer.");
    }
  };
  const details = spendApprovalDetails(item);
  return (
    <View
      accessibilityLabel="Approve before spending"
      className="gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <View className="gap-1">
        <Text className="text-sm font-t3-medium">{item.description}</Text>
        <Text className="text-sm text-foreground-muted">
          Costs about{" "}
          <Text className="font-t3-medium text-foreground">{formatSpendAmount(item.estimate)}</Text>
        </Text>
      </View>
      {details.length > 0 ? (
        <View className="gap-1">
          {details.map(([key, value]) => (
            <View key={key} className="flex-row gap-3">
              <Text className="w-20 text-2xs text-foreground-muted">{key}</Text>
              <Text className="flex-1 text-2xs">{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {error}
        </Text>
      )}
      <View className="flex-row justify-end gap-2">
        <SmallButton
          tone="ghost"
          label={pending === "decline" ? "Declining…" : "Decline"}
          disabled={!canAnswer || pending !== null}
          onPress={() => void send("decline")}
        />
        <SmallButton
          tone="contrast"
          label={pending === "approve" ? "Approving…" : "Approve"}
          disabled={!canAnswer || pending !== null}
          onPress={() => void send("approve")}
        />
      </View>
      {canAnswer ? null : (
        <Text className="text-xs text-foreground-muted">
          This connection can't approve spending.
        </Text>
      )}
    </View>
  );
}

/** A question one tap answers: one single-choice question with options, resumable live. */
function quickAnswerable(input: ThreadPendingUserInput) {
  const question = input.questions[0];
  return input.questions.length === 1 &&
    question !== undefined &&
    !question.multiSelect &&
    question.options.length > 0 &&
    input.responseCapability !== "not_resumable" &&
    input.responseMode !== "message"
    ? question
    : null;
}

/**
 * What the Work agent is waiting on besides spend: tool approvals and questions. Approvals and
 * single-choice questions are answered here; anything longer opens in the full chat.
 */
export function PendingRequestsCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly requests: PendingThreadRequests;
  readonly canOperate: boolean;
  readonly onOpenChat: () => void;
}) {
  const respondToApproval = useAtomCommand(
    threadEnvironment.respondToApproval,
    "approval response",
  );
  const respondToUserInput = useAtomCommand(
    threadEnvironment.respondToUserInput,
    "answer question",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const { approvals, userInputs } = props.requests;
  if (approvals.length === 0 && userInputs.length === 0) return null;
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy !== null) return;
    setBusy(key);
    await action();
    setBusy(null);
  };
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-2">
        <SymbolView name="questionmark.bubble" size={16} tintColorClassName="accent-icon" />
        <Text className="text-sm font-t3-medium">The agent is waiting for you</Text>
      </View>
      {approvals.map((approval) => (
        <View key={approval.requestId} className="gap-2">
          <Text className="text-sm">
            {approval.detail ?? approval.reason ?? "Approve this action?"}
          </Text>
          {props.canOperate && approval.responseCapability === "live" ? (
            <View className="flex-row justify-end gap-2">
              <SmallButton
                tone="ghost"
                label="Decline"
                disabled={busy !== null}
                onPress={() =>
                  void run(approval.requestId, () =>
                    respondToApproval({
                      environmentId: props.environmentId,
                      input: {
                        threadId: props.threadId,
                        requestId: approval.requestId,
                        decision: "decline",
                      },
                    }),
                  )
                }
              />
              <SmallButton
                tone="contrast"
                label="Approve"
                disabled={busy !== null}
                onPress={() =>
                  void run(approval.requestId, () =>
                    respondToApproval({
                      environmentId: props.environmentId,
                      input: {
                        threadId: props.threadId,
                        requestId: approval.requestId,
                        decision: "accept",
                      },
                    }),
                  )
                }
              />
            </View>
          ) : null}
        </View>
      ))}
      {userInputs.map((request) => {
        const question = quickAnswerable(request);
        return (
          <View key={request.requestId} className="gap-2">
            {request.questions.map((entry) => (
              <View key={entry.id} className="gap-0.5">
                <Text className="text-2xs text-foreground-muted">{entry.header}</Text>
                <Text className="text-sm">{entry.question}</Text>
              </View>
            ))}
            {question !== null && props.canOperate ? (
              <View className="flex-row flex-wrap gap-2">
                {question.options.map((option) => (
                  <SmallButton
                    key={option.label}
                    label={option.label}
                    disabled={busy !== null}
                    onPress={() => {
                      const answers = buildPendingUserInputAnswers(request.questions, {
                        [question.id]: togglePendingUserInputOptionSelection(
                          question,
                          undefined,
                          option.value ?? option.label,
                        ),
                      });
                      if (answers === null) return;
                      void run(request.requestId, () =>
                        respondToUserInput({
                          environmentId: props.environmentId,
                          input: {
                            threadId: props.threadId,
                            requestId: request.requestId,
                            answers,
                          },
                        }),
                      );
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={props.onOpenChat}
        hitSlop={6}
        className="self-start"
      >
        <Text className="text-xs font-t3-medium underline">Answer in the full chat</Text>
      </Pressable>
    </View>
  );
}
