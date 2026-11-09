import { createFileRoute } from "@tanstack/react-router";

import { WorkShelf } from "../components/work/WorkShelf";

export const Route = createFileRoute("/_chat/work/")({
  component: WorkShelf,
});
