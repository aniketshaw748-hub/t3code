import { MicIcon, MonitorIcon, PencilIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The floating Talk, Record and Draw toolbar over the player or slide. */
export function CaptureToolbar(props: {
  readonly talking: boolean;
  readonly talkAvailable: boolean;
  readonly onTalk: () => void;
  readonly onDraw: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Leave a note"
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-black/70 p-1 shadow-lg backdrop-blur"
    >
      <ToolbarButton
        label={
          props.talkAvailable
            ? props.talking
              ? "Listening… press again to stop"
              : "Talk: dictate a note"
            : "Voice input is not set up on this machine"
        }
        disabled={!props.talkAvailable}
        pressed={props.talking}
        onClick={props.onTalk}
      >
        <MicIcon />
      </ToolbarButton>
      <ToolbarButton label="Screen recording is not available yet" disabled onClick={() => {}}>
        <MonitorIcon />
      </ToolbarButton>
      <ToolbarButton label="Draw on the frame" onClick={props.onDraw}>
        <PencilIcon />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="overlay"
            size="icon-sm-pill"
            aria-label={props.label}
            aria-pressed={props.pressed ?? undefined}
            aria-disabled={props.disabled || undefined}
            data-pressed={props.pressed ? "" : undefined}
            onClick={props.disabled ? undefined : props.onClick}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
