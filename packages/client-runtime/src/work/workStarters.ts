import type { DeliverableKind } from "@t3tools/contracts";

/**
 * A "Start" chip on the Work shelf: it creates a Work project and a thread that opens with
 * `prompt`. `skill` names an agent skill the prompt asks for, so a setup can map chips to the
 * skills it has installed; agents without it fall back to the plain instructions.
 */
export interface WorkStarter {
  readonly id: string;
  readonly label: string;
  readonly kind: DeliverableKind;
  readonly projectName: string;
  readonly skill: string | null;
  readonly prompt: string;
}

const REPORT_BACK =
  "Save the result in this project and keep each change you make as a new version of the same file. Before any paid generation step, ask me to approve its cost with request_spend_approval.";

export const WORK_STARTERS: ReadonlyArray<WorkStarter> = [
  {
    id: "deck",
    label: "Make a deck",
    kind: "deck",
    projectName: "New deck",
    skill: "deck-building",
    prompt: `Let's make a presentation deck (.pptx). Use the deck-building skill if you have it. Ask me what it is for, who it is for and roughly how many slides, then draft it. ${REPORT_BACK}`,
  },
  {
    id: "video",
    label: "Cut a video",
    kind: "video",
    projectName: "New video",
    skill: "hyperframes",
    prompt: `Let's make a short video (.mp4). Use the hyperframes skill if you have it. Ask me what it is for, how long it should be and what footage or style to use, then make a first cut. ${REPORT_BACK}`,
  },
  {
    id: "images",
    label: "Image set",
    kind: "image",
    projectName: "New image set",
    skill: null,
    prompt: `Let's make a set of images. Ask me what they are for, how many and in what style, then make a first set as PNG files and register each with deliverable_register_version. ${REPORT_BACK}`,
  },
];
