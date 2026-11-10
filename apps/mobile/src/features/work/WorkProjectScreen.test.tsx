import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", async () => (await import("./work.test-support")).reactNativeDom);
vi.mock("uniwind", async () => (await import("./work.test-support")).appDom.uniwind);
vi.mock("expo", async () => (await import("./work.test-support")).appDom.expo);
vi.mock("expo-image", async () => (await import("./work.test-support")).appDom.image);
vi.mock("expo-video", async () => (await import("./work.test-support")).appDom.video);
vi.mock("expo-glass-effect", async () => (await import("./work.test-support")).appDom.glass);
vi.mock(
  "@react-navigation/native",
  async () => (await import("./work.test-support")).appDom.navigation,
);
vi.mock(
  "react-native-keyboard-controller",
  async () => (await import("./work.test-support")).appDom.keyboard,
);
vi.mock(
  "react-native-safe-area-context",
  async () => (await import("./work.test-support")).appDom.safeArea,
);
vi.mock("@effect/atom-react", async () => (await import("./work.test-support")).appDom.atoms);
vi.mock(
  "../../components/ui/AppSymbol",
  async () => (await import("./work.test-support")).appDom.symbol,
);
vi.mock(
  "../../components/ui/AppBar",
  async () => (await import("./work.test-support")).appDom.appBar,
);
vi.mock(
  "../../components/ui/ScreenContent",
  async () => (await import("./work.test-support")).appDom.screenContent,
);
vi.mock(
  "../../components/ui/SegmentedControl",
  async () => (await import("./work.test-support")).appDom.segmentedControl,
);
vi.mock(
  "../../components/ui/ListRow",
  async () => (await import("./work.test-support")).appDom.listRow,
);
vi.mock(
  "../../components/ui/Dialog",
  async () => (await import("./work.test-support")).appDom.dialog,
);
vi.mock(
  "../../components/ComposerToolbar",
  async () => (await import("./work.test-support")).appDom.composerToolbar,
);
vi.mock(
  "../../native/native-glass",
  async () => (await import("./work.test-support")).appDom.nativeGlass,
);
vi.mock(
  "../../state/atom-registry",
  async () => (await import("./work.test-support")).appDom.atomRegistry,
);
vi.mock(
  "../voice-input/useVoiceInputController",
  async () => (await import("./work.test-support")).appDom.voiceController,
);
vi.mock(
  "../voice-input/ComposerDictationControl",
  async () => (await import("./work.test-support")).appDom.voiceControls,
);
vi.mock("./useWorkData", async () => (await import("./work.test-support")).workState.data);
vi.mock("./useWorkActions", async () => (await import("./work.test-support")).workState.actions);
vi.mock(
  "../../state/use-atom-command",
  async () => (await import("./work.test-support")).workState.useAtomCommand,
);
vi.mock("../../state/work", async () => (await import("./work.test-support")).workState.work);
vi.mock("../../state/server", async () => (await import("./work.test-support")).workState.server);
vi.mock("../../state/threads", async () => (await import("./work.test-support")).workState.threads);
vi.mock(
  "../../state/entities",
  async () => (await import("./work.test-support")).workState.entities,
);
vi.mock("../../state/session", async () => (await import("./work.test-support")).workState.session);

import {
  drag,
  hostCalls,
  layout,
  setWorkScene,
  WORK_TARGET,
  workDeliverable,
  workNote,
  workRendition,
  workSnapshot,
  workVersion,
  type WorkScene,
} from "./work.test-support";
import { WorkProjectRouteScreen } from "./WorkProjectScreen";

const deck = (notes: Parameters<typeof workSnapshot>[0]["notes"] = []): WorkScene => ({
  snapshot: workSnapshot({
    deliverable: workDeliverable({ kind: "deck", title: "pitch.pptx", currentVersion: "v2" }),
    versions: [
      workVersion({ id: "v1", ordinal: 1 }),
      workVersion({ id: "v2", ordinal: 2, parent: "v1", summary: "Tightened the title slide" }),
    ],
    notes,
  }),
  renditions: [workRendition({ versionId: "v2", units: 3, unitKind: "slide" })],
  thread: { runtimeMode: "full-access", interactionMode: "default", source: { status: "idle" } },
  busy: false,
  canOperate: true,
});

// A 16:9 slide on a stage a phone wide: the frame fills it, 390 by 219.375.
const FRAME = "work-media-frame";
const STAGE = { width: 390, height: 219.375 };

/** Boxes the area from a tenth of the way in to the middle of the slide. */
function markArea() {
  act(() => layout(FRAME, STAGE));
  act(() => layout("Mark an area", STAGE));
  act(() => drag("Mark an area", [39, 21.9375], [195, 109.6875]));
}

function open(scene: WorkScene) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorkScene(scene);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<WorkProjectRouteScreen route={{ params: WORK_TARGET } as never} />));
  const labelled = (label: string) => {
    const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    if (found === null) throw new Error(`Nothing is labelled "${label}".`);
    return found;
  };
  const named = (text: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    );
    if (found === undefined) throw new Error(`No button says "${text}".`);
    return found;
  };
  return {
    container,
    labelled,
    named,
    press: (button: HTMLElement) => act(async () => button.click()),
    type: (text: string) =>
      act(() => {
        const input = labelled("Note for the agent") as HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

it("pins a note to an area boxed on the picked slide", async () => {
  using screen = open(deck());
  await screen.press(screen.labelled("Slide 2: Part 2"));
  // No area is marked yet, so the note would pin to the slide alone.
  expect(screen.named("At Slide 2").getAttribute("aria-pressed")).toBe("true");

  await screen.press(screen.labelled("Mark an area for a note"));
  markArea();
  await screen.press(screen.named("Use area"));

  expect(screen.container.textContent).toContain("Area marked");
  // A marked area points at a place, so the note can no longer be about the whole deck.
  expect(screen.named("Whole deck").disabled).toBe(true);

  screen.type("Logo is too small here");
  await screen.press(screen.labelled("Send note"));

  const [created] = hostCalls("createNote") as Array<{
    anchor: { region: Record<string, number> };
  }>;
  expect(created).toMatchObject({ body: "Logo is too small here", versionId: "v2" });
  expect(created?.anchor).toMatchObject({ kind: "slide", index: 1 });
  expect(
    Object.entries(created?.anchor.region ?? {}).map(([key, value]) => [key, value.toFixed(3)]),
  ).toEqual([
    ["x", "0.100"],
    ["y", "0.100"],
    ["w", "0.400"],
    ["h", "0.400"],
  ]);
  expect(hostCalls("sendNotes")).toHaveLength(1);
  // The area went with that note; the next one starts without it.
  expect(screen.container.textContent).not.toContain("Area marked");
});

it("drops a marked area when the user leaves the slide it was drawn on", async () => {
  using screen = open(deck());
  await screen.press(screen.labelled("Slide 2: Part 2"));
  await screen.press(screen.labelled("Mark an area for a note"));
  markArea();
  await screen.press(screen.named("Use area"));
  expect(screen.container.textContent).toContain("Area marked");

  await screen.press(screen.labelled("Next slide"));
  expect(screen.container.textContent).not.toContain("Area marked");
  expect(screen.named("At Slide 3").getAttribute("aria-pressed")).toBe("true");
});

it("sends words about the whole deck as chat, with no note to track", async () => {
  using screen = open(deck());
  await screen.press(screen.labelled("Slide 1: Part 1"));
  await screen.press(screen.named("Whole deck"));
  screen.type("Make it all more formal");
  await screen.press(screen.labelled("Send message"));

  expect(hostCalls("createNote")).toEqual([]);
  expect(hostCalls("sendMessage")).toEqual([
    "On pitch.pptx, V2, about the whole deck:\nMake it all more formal",
  ]);
});

it("says each note's status in words and outlines the selected note's area on its slide", async () => {
  const region = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
  using screen = open(
    deck([
      workNote({
        id: "note-area",
        versionId: "v2",
        anchor: { kind: "slide", index: 2, region },
        body: "Chart labels overlap",
      }),
      workNote({
        id: "note-fixed",
        versionId: "v1",
        anchor: { kind: "slide", index: 0 },
        body: "Title is too long",
        status: "fixed",
        fixedIn: "v2",
        reply: "Shortened the title.",
      }),
    ]),
  );
  expect(screen.container.textContent).toContain("V2 · current · 3 slides");
  expect(screen.container.textContent).toContain("1 open");
  expect(screen.container.textContent).toContain("1 fixed, check it");
  expect(screen.container.textContent).toContain("Fixed in V2");
  expect(screen.named("Check slide 1 in V2")).toBeTruthy();
  // The note's own card shows its area on the slide it is about.
  expect(screen.container.querySelectorAll('[style*="left: 25%"]')).toHaveLength(1);

  await screen.press(screen.labelled("Go to slide 3, the area 25%-75% across, 50%-75% down"));
  // Now the stage shows slide 3 with the same area outlined on it.
  act(() => layout(FRAME, STAGE));
  expect(screen.container.querySelector('img[alt="Slide 3: Part 3"]')).not.toBeNull();
  expect(screen.container.querySelectorAll('[style*="left: 25%"]')).toHaveLength(2);
});

it("leaves a connection that can't leave notes without a way to mark an area", async () => {
  using screen = open({ ...deck(), canOperate: false });
  await screen.press(screen.labelled("Slide 2: Part 2"));
  expect(screen.container.querySelector('[aria-label="Mark an area for a note"]')).toBeNull();
  expect((screen.labelled("Note for the agent") as HTMLTextAreaElement).readOnly).toBe(true);
});
