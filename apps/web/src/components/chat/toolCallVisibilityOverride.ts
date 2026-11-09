import type { ToolCallVisibility } from "@t3tools/contracts";
import { createContext } from "react";

/** Set by a surface that always hides tool calls, such as Work mode's chat, over the user's setting. */
export const ToolCallVisibilityOverride = createContext<ToolCallVisibility | null>(null);
