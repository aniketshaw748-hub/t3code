import { MicIcon, MonitorIcon, PencilIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface CaptureToolsProps {
  readonly talking: boolean;
  readonly talkAvailable: boolean;
  readonly onTalk: () => void;
  readonly onDraw: () => void;
}

/** Talk, Record and Draw: the ways to leave a note, in the stage's own row of controls. */
export function CaptureTools(props: CaptureToolsProps) {
  return (
    <div role="toolbar" aria-label="Leave a note" className="flex shrink-0 items-center gap-0.5">
      <ToolButton
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
      </ToolButton>
      <ToolButton label="Screen recording is not available yet" disabled onClick={() => {}}>
        <MonitorIcon />
      </ToolButton>
      <ToolButton label="Draw on the frame" onClick={props.onDraw}>
        <PencilIcon />
      </ToolButton>
    </div>
  );
}

function ToolButton(props: {
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
            variant="ghost"
            size="icon-xs"
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
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
