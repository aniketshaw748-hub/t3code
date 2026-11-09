import { createFileRoute } from "@tanstack/react-router";

import { BubbleSurface } from "../components/bubble/BubbleSurface";

export const Route = createFileRoute("/bubble")({
  component: BubbleSurface,
});
