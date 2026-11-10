import type { Deliverable } from "@t3tools/contracts";
import { FileIcon, MapPinIcon, PencilLineIcon, XIcon } from "lucide-react";
import type { RefObject } from "react";

import { TextFieldSpeechControls, type TextFieldSpeech } from "../../speech/useTextFieldSpeech";
import { textDirection } from "../../textDirection";
import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import { ComposerPrimaryActions } from "../chat/ComposerPrimaryActions";
import { ComposerSurface } from "../chat/ComposerSurface";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { Drawing } from "./DrawOverlay";

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

const NO_OP = () => {};

const DELIVERABLE_NOUN: Record<Deliverable["kind"], string> = {
  deck: "deck",
  video: "video",
  image: "file",
  pdf: "file",
  other: "file",
};

/**
 * Where notes and messages to the agent are written. It is the chat composer's card, footer
 * controls and send button around a plain text field, with one choice the chat does not have:
 * whether the words pin to a place in the work or are about all of it.
 */
export function NoteComposer({
  textareaRef,
  ...props
}: {
  readonly kind: Deliverable["kind"];
  readonly hasWork: boolean;
  readonly disabled: boolean;
  /** What a pinned note would point at right now: `0:42`, `Slide 3`, or null when nothing is. */
  readonly pinLabel: string | null;
  readonly composer: NoteComposerState;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly sending: boolean;
  readonly onSend: () => void;
}) {
  const { composer } = props;
  const noun = DELIVERABLE_NOUN[props.kind];
  const pinned = composer.pinned && props.pinLabel !== null;
  const hasText = composer.text.trim().length > 0;
  const canSend = !props.disabled && !props.sending && hasText && !composer.speech.blocksSubmission;
  const submit = () => {
    if (canSend) props.onSend();
  };
  return (
    <div className="shrink-0 px-3 pb-3">
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <ComposerSurface.Main>
              <div className="rounded-2xl">
                {composer.drawing !== null ? (
                  <div className="flex items-center gap-1 px-3 pt-3">
                    <Badge variant="outline" size="lg">
                      <PencilLineIcon aria-hidden />
                      Drawing attached
                    </Badge>
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="Remove drawing"
                      onClick={composer.clearDrawing}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ) : null}
                <textarea
                  ref={textareaRef}
                  rows={2}
                  dir={textDirection(composer.text)}
                  disabled={props.disabled}
                  aria-label="Note for the agent"
                  placeholder={
                    !props.hasWork
                      ? "Tell the agent what to make"
                      : pinned
                        ? `Leave a note at ${props.pinLabel}`
                        : `Ask for a change to the whole ${noun}`
                  }
                  value={composer.text}
                  onChange={(event) => composer.setText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  className="field-sizing-content block max-h-48 min-h-[2lh] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) text-foreground outline-none wrap-anywhere placeholder:text-placeholder disabled:opacity-64 max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)"
                />
                <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2">
                  {props.hasWork ? (
                    <div
                      role="radiogroup"
                      aria-label="What the note is about"
                      className="mr-auto flex min-w-0 items-center gap-0.5"
                    >
                      <ComposerControl
                        size="xs"
                        role="radio"
                        aria-checked={pinned}
                        aria-pressed={pinned}
                        disabled={props.pinLabel === null}
                        title={
                          props.pinLabel === null
                            ? "Pick a slide or draw on the frame to pin a note"
                            : "A note pinned to this place, tracked until it is fixed"
                        }
                        onClick={() => composer.setPinned(true)}
                      >
                        <ComposerControlIcon icon={MapPinIcon} size="xs" />
                        <span data-composer-control-label>
                          {props.pinLabel === null ? "Pin here" : `At ${props.pinLabel}`}
                        </span>
                      </ComposerControl>
                      <ComposerControl
                        size="xs"
                        role="radio"
                        aria-checked={!pinned}
                        aria-pressed={!pinned}
                        title={`A message about the whole ${noun}, not pinned anywhere`}
                        onClick={() => composer.setPinned(false)}
                      >
                        <ComposerControlIcon icon={FileIcon} size="xs" />
                        <span data-composer-control-label>Whole {noun}</span>
                      </ComposerControl>
                    </div>
                  ) : (
                    <span className="mr-auto" />
                  )}
                  <ComposerPrimaryActions
                    compact
                    canOperateThread={!props.disabled}
                    pendingAction={null}
                    isRunning={false}
                    canInterrupt={false}
                    voiceInputActive={composer.speech.state.phase !== "idle"}
                    isSendBusy={props.sending}
                    sendDisabledReason={
                      composer.speech.blocksSubmission ? "Finish dictating first" : null
                    }
                    isEnvironmentUnavailable={false}
                    isPreparingWorktree={false}
                    hasSendableContent={hasText}
                    onPreviousPendingQuestion={NO_OP}
                    onInterrupt={NO_OP}
                  >
                    <TextFieldSpeechControls speech={composer.speech} disabled={props.disabled} />
                  </ComposerPrimaryActions>
                </div>
              </div>
            </ComposerSurface.Main>
          </form>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </div>
  );
}
