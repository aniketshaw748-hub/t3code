import { useAtomValue } from "@effect/atom-react";
import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  PendingThreadRequests,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  formatSpendAmount,
  spendApprovalDetails,
  type SpendApprovalTurnItem,
} from "@t3tools/client-runtime/work/anchors";
import { type WorkRunFailure, workRunFailureDetail } from "@t3tools/client-runtime/work/shelf";
import type {
  Deliverable,
  DeliverableRendition,
  DeliverableVersion,
  EnvironmentId,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import { PendingApprovalCard } from "../threads/PendingApprovalCard";
import { WorkBanner } from "./WorkBanner";
import { WorkLink } from "./WorkLink";

/** The agent's last run ended early: what happened in plain words, and a way to try again. */
export function RunFailureBanner(props: {
  readonly failure: WorkRunFailure;
  readonly canOperate: boolean;
  readonly retrying: boolean;
  /** Null when there is nothing to send again. */
  readonly onRetry: (() => void) | null;
  readonly onOpenChat: () => void;
}) {
  return (
    <WorkBanner
      alert
      tone={props.failure.kind === "error" ? "danger" : "warning"}
      icon="exclamationmark.circle"
      title={props.failure.title}
      detail={workRunFailureDetail(props.failure)}
    >
      <Button tone="text" size="compact" label="Details" onPress={props.onOpenChat} />
      {props.canOperate && props.onRetry !== null ? (
        <Button
          tone="secondary"
          size="compact"
          icon="arrow.clockwise"
          label="Retry"
          disabled={props.retrying}
          onPress={props.onRetry}
        />
      ) : null}
    </WorkBanner>
  );
}

/** A version's render ended without a preview: why, in plain words, and a way to render again. */
export function RenderFailureBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly version: DeliverableVersion;
  readonly rendition: DeliverableRendition;
  readonly canOperate: boolean;
}) {
  const retryRendition = useAtomCommand(workEnvironment.retryRendition, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const retry = async () => {
    setPending(true);
    const result = await retryRendition({
      environmentId: props.environmentId,
      input: { versionId: props.version.id },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert("Could not render it again", error instanceof Error ? error.message : undefined);
    }
  };
  return (
    <WorkBanner
      alert
      tone="warning"
      icon="exclamationmark.circle"
      title={`V${props.version.ordinal} could not be rendered`}
      detail={props.rendition.detail}
    >
      {props.canOperate ? (
        <Button
          tone="secondary"
          size="compact"
          icon="arrow.clockwise"
          label="Render again"
          disabled={pending}
          onPress={() => void retry()}
        />
      ) : null}
    </WorkBanner>
  );
}

/**
 * The agent saved a revision as a new file instead of overwriting the deliverable. One tap
 * makes it the deliverable's next version, so the version history stays in one place.
 */
export function StrayFileBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly stray: Deliverable;
  readonly original: Deliverable;
  readonly canOperate: boolean;
  /** Adopting rewrites the workspace, so it waits for the agent's turn to end. */
  readonly turnRunning: boolean;
}) {
  const resolve = useAtomCommand(workEnvironment.resolveStray, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const nextOrdinal = props.original.versionCount + 1;
  const run = async (adopt: boolean) => {
    setPending(true);
    const result = await resolve({
      environmentId: props.environmentId,
      input: { deliverableId: props.stray.id, adopt },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        adopt ? "Could not use it as a version" : "Could not keep the file",
        error instanceof Error ? error.message : undefined,
      );
    }
  };
  return (
    <WorkBanner
      tone="info"
      icon="doc.on.doc"
      title="Saved as a new file"
      detail={`Use ${props.stray.title} as V${nextOrdinal} of ${props.original.title}?${
        props.canOperate && props.turnRunning ? " Wait for the agent's turn to finish first." : ""
      }`}
    >
      {props.canOperate ? (
        <>
          <Button
            tone="text"
            size="compact"
            label="Keep as its own file"
            disabled={pending}
            onPress={() => void run(false)}
          />
          <Button
            tone="primary"
            size="compact"
            label={`Use as V${nextOrdinal}`}
            disabled={pending || props.turnRunning}
            onPress={() => void run(true)}
          />
        </>
      ) : null}
    </WorkBanner>
  );
}

/** The card the chat draws for a request, so one in Work reads the same as one in a thread. */
function RequestCard(props: {
  readonly eyebrow: string;
  readonly accessibilityLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4"
    >
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
        {props.eyebrow}
      </Text>
      {props.children}
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
    <RequestCard eyebrow="Approve before spending" accessibilityLabel="Approve before spending">
      <Text className="font-t3-bold text-lg text-foreground">
        About {formatSpendAmount(item.estimate)}
      </Text>
      <Text className="font-sans text-sm leading-normal text-foreground-secondary">
        {item.description}
      </Text>
      {details.length > 0 ? (
        <View className="gap-1">
          {details.map(([key, value]) => (
            <View key={key} className="flex-row gap-3">
              <Text className="w-20 text-xs text-foreground-muted">{key}</Text>
              <Text className="flex-1 text-xs">{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {error}
        </Text>
      )}
      <View className="gap-2">
        <Button
          fullWidth
          tone="primary"
          label={pending === "approve" ? "Approving…" : "Approve"}
          disabled={!canAnswer || pending !== null}
          onPress={() => void send("approve")}
        />
        <Button
          fullWidth
          tone="danger"
          label={pending === "decline" ? "Declining…" : "Decline"}
          disabled={!canAnswer || pending !== null}
          onPress={() => void send("decline")}
        />
      </View>
      {canAnswer ? null : (
        <Text className="font-sans text-xs text-foreground-muted">
          This connection can't approve spending.
        </Text>
      )}
    </RequestCard>
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
 * What the Work agent is waiting on besides spend: tool approvals, drawn by the chat's own
 * approval card, and questions. A single-choice question is answered here; anything longer
 * opens in the full chat.
 */
export function PendingRequestCards(props: {
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
  const [responding, setResponding] = useState<RuntimeRequestId | null>(null);
  const run = async (requestId: RuntimeRequestId, action: () => Promise<unknown>) => {
    if (responding !== null) return;
    setResponding(requestId);
    await action();
    setResponding(null);
  };
  const { approvals, userInputs } = props.requests;
  return (
    <>
      {approvals.map((approval) => (
        <PendingApprovalCard
          key={approval.requestId}
          canOperateThread={props.canOperate}
          approval={approval}
          respondingApprovalId={responding}
          onRespond={(requestId: RuntimeRequestId, decision: ProviderApprovalDecision) =>
            run(requestId, () =>
              respondToApproval({
                environmentId: props.environmentId,
                input: { threadId: props.threadId, requestId, decision },
              }),
            )
          }
        />
      ))}
      {userInputs.map((request) => {
        const question = quickAnswerable(request);
        return (
          <RequestCard key={request.requestId} eyebrow="The agent has a question">
            {request.questions.map((entry) => (
              <View key={entry.id} className="gap-1">
                <Text className="font-t3-bold text-lg text-foreground">{entry.header}</Text>
                <Text className="font-sans text-sm leading-normal text-foreground-secondary">
                  {entry.question}
                </Text>
              </View>
            ))}
            {question !== null && props.canOperate ? (
              <View className="gap-2">
                {question.options.map((option) => (
                  <Button
                    key={option.label}
                    fullWidth
                    tone="secondary"
                    label={option.label}
                    disabled={responding !== null}
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
            <WorkLink label="Answer in the full chat" onPress={props.onOpenChat} />
          </RequestCard>
        );
      })}
    </>
  );
}
