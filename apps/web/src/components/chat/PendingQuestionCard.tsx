import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  seedUserInputDraftAnswers,
  type ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MessageCircleQuestionMarkIcon } from "lucide-react";
import { useRef, useState } from "react";

import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { ComposerRequestCard } from "./ComposerRequestCard";

/**
 * An agent's question, answerable where it shows: pick an option or type an answer. Surfaces
 * without the chat composer (Work mode, the bubble) use it so a question never waits unseen.
 */
export function PendingQuestionCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly request: ThreadPendingUserInput;
  readonly onOpenFull?: () => void;
}) {
  const { request } = props;
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismiss = useAtomCommand(threadEnvironment.dismissUserInput, { reportFailure: false });
  const [edits, setEdits] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two clicks can land before a render.
  const inFlight = useRef(false);
  const drafts = seedUserInputDraftAnswers(request.questions, edits);
  const answers = buildPendingUserInputAnswers(request.questions, drafts);
  const answerable = request.responseCapability !== "not_resumable";

  const run = async (action: "answer" | "dismiss") => {
    if (inFlight.current || (action === "answer" && answers === null)) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const target = { threadId: props.threadId, requestId: request.requestId };
    const result =
      action === "answer"
        ? await respond({
            environmentId: props.environmentId,
            input: { ...target, answers: answers ?? {} },
          })
        : await dismiss({ environmentId: props.environmentId, input: target });
    inFlight.current = false;
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not send the answer.");
    }
  };

  return (
    <div className="overflow-hidden rounded-card surface-panel">
      <ComposerRequestCard.Root role="region" aria-label="The agent has a question">
        <ComposerRequestCard.Header
          icon={<MessageCircleQuestionMarkIcon className="text-warning-foreground" />}
          title="The agent has a question"
        />
        {request.questions.map((question) => (
          <ComposerRequestCard.Body key={question.id}>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="wrap-anywhere">{question.question}</p>
              {question.options.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {question.options.map((option) => {
                    const value = option.value ?? option.label;
                    const selected = isPendingUserInputOptionSelected(
                      question,
                      drafts[question.id],
                      value,
                    );
                    return (
                      <Button
                        key={value}
                        size="xs"
                        variant={selected ? "default" : "secondary"}
                        aria-pressed={selected}
                        disabled={!answerable || pending}
                        title={option.description}
                        onClick={() =>
                          setEdits((current) => ({
                            ...current,
                            [question.id]: togglePendingUserInputOptionSelection(
                              question,
                              drafts[question.id],
                              value,
                            ),
                          }))
                        }
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
              {question.allowCustomAnswer === false ? null : (
                <Textarea
                  size="sm"
                  rows={1}
                  disabled={!answerable || pending}
                  aria-label={`Answer: ${question.question}`}
                  placeholder={question.options.length > 0 ? "Or type an answer" : "Type an answer"}
                  value={drafts[question.id]?.customAnswer ?? ""}
                  onChange={(event) => {
                    const customAnswer = event.currentTarget.value;
                    setEdits((current) => ({
                      ...current,
                      [question.id]: setPendingUserInputCustomAnswer(
                        question,
                        drafts[question.id],
                        customAnswer,
                      ),
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void run("answer");
                    }
                  }}
                />
              )}
            </div>
          </ComposerRequestCard.Body>
        ))}
        {error === null ? null : (
          <p role="alert" className="px-2.5 text-meta text-error-foreground">
            {error}
          </p>
        )}
        <ComposerRequestCard.Footer>
          {props.onOpenFull === undefined ? null : (
            <Button size="xs" variant="ghost-muted" onClick={props.onOpenFull}>
              Open the chat
            </Button>
          )}
          {request.dismissible ? (
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={pending}
              onClick={() => void run("dismiss")}
            >
              Dismiss
            </Button>
          ) : null}
          {answerable ? (
            <Button
              size="xs"
              variant="default"
              disabled={pending || answers === null}
              onClick={() => void run("answer")}
            >
              {pending ? "Sending…" : "Answer"}
            </Button>
          ) : (
            <p className="text-meta text-muted-foreground">
              This question can no longer be answered here.
            </p>
          )}
        </ComposerRequestCard.Footer>
      </ComposerRequestCard.Root>
    </div>
  );
}
