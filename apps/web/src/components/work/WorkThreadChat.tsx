import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ComposerHandleContext } from "../../composerHandleContext";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ToolCallVisibilityOverride } from "../chat/toolCallVisibilityOverride";
import { toastManager } from "../ui/toast";

// Work mode has no diff panel or terminal; those stay in Code mode.
const WORK_PARENT_PANEL: SideChatParentPanel = {
  openToolDiff: () =>
    toastManager.add({
      type: "info",
      title: "Diffs open in Code mode",
      description: "Switch to Code in the sidebar to see what changed in the files.",
    }),
  runShellCommand: () =>
    toastManager.add({
      type: "info",
      title: "Terminals open in Code mode",
      description: "Switch to Code in the sidebar to run commands.",
    }),
};

/** The project's whole conversation, with tool calls folded away. */
export function WorkThreadChat(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  return (
    <div data-side-chat-pane className="flex h-full min-h-0 flex-col">
      <ToolCallVisibilityOverride value="zen">
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={props.environmentId}
              threadId={props.threadId}
              routeKind="server"
              embedded={WORK_PARENT_PANEL}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      </ToolCallVisibilityOverride>
    </div>
  );
}
