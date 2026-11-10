import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", async () => (await import("./work.test-support")).reactNativeDom);
vi.mock("uniwind", async () => (await import("./work.test-support")).appDom.uniwind);
vi.mock("expo-image", async () => (await import("./work.test-support")).appDom.image);
vi.mock("expo-glass-effect", async () => (await import("./work.test-support")).appDom.glass);
vi.mock(
  "@react-navigation/native",
  async () => (await import("./work.test-support")).appDom.navigation,
);
vi.mock(
  "react-native-safe-area-context",
  async () => (await import("./work.test-support")).appDom.safeArea,
);
vi.mock(
  "../../components/ui/AppSymbol",
  async () => (await import("./work.test-support")).appDom.symbol,
);
vi.mock(
  "../../components/ui/ScreenScrollView",
  async () => (await import("./work.test-support")).appDom.screenScrollView,
);
vi.mock(
  "../../native/native-glass",
  async () => (await import("./work.test-support")).appDom.nativeGlass,
);
vi.mock(
  "../settings/components/SettingsScreen",
  async () => (await import("./work.test-support")).appDom.settingsScreen,
);
vi.mock(
  "../../state/environments",
  async () => (await import("./work.test-support")).workState.environments,
);
vi.mock("./useWorkData", async () => (await import("./work.test-support")).workState.data);
vi.mock("./useWorkActions", async () => (await import("./work.test-support")).workState.actions);

import {
  hostCalls,
  setWorkScene,
  WORK_TARGET,
  workDeliverable,
  workNote,
  workSnapshot,
  workVersion,
  type WorkScene,
} from "./work.test-support";
import { WorkShelfScreen } from "./WorkShelfScreen";

const film = (overrides: Partial<WorkScene>): WorkScene => ({
  snapshot: workSnapshot({
    deliverable: workDeliverable({ kind: "video", title: "film.mp4", currentVersion: "v3" }),
    versions: [workVersion({ id: "v3", ordinal: 3 })],
    notes: [
      workNote({ id: "a", versionId: "v3", anchor: { kind: "time", t: 4 }, body: "Too fast" }),
      workNote({ id: "b", versionId: "v3", anchor: { kind: "time", t: 9 }, body: "Too loud" }),
    ],
  }),
  renditions: [],
  thread: { source: { status: "idle", activeRunId: null, pendingRuntimeRequest: null } },
  busy: false,
  canOperate: true,
  ...overrides,
});

function open(scene: WorkScene) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorkScene(scene);
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<WorkShelfScreen />));
  return { container, [Symbol.dispose]: () => act(() => root.unmount()) };
}

it("shows each project's status in words beside the version it is about", () => {
  using shelf = open(film({}));
  const card = shelf.container.querySelector('[aria-label="Launch film, 2 notes open, V3"]');
  expect(card?.textContent).toBe("Launch filmV32 notes open");
  expect(shelf.container.querySelector("main p")?.textContent).toBe("1 project");
});

it("puts the agent's work ahead of the notes while it runs", () => {
  using shelf = open(
    film({
      thread: { source: { status: "running", activeRunId: "run-1", pendingRuntimeRequest: null } },
    }),
  );
  expect(shelf.container.textContent).toContain("Launch filmV3Agent working");
});

it("opens the project a card stands for", () => {
  using shelf = open(film({}));
  act(() => shelf.container.querySelector<HTMLElement>('[aria-label^="Launch film"]')!.click());
  expect(hostCalls("navigate")).toEqual([{ name: "WorkProject", params: WORK_TARGET }]);
});
