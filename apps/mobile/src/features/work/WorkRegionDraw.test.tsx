import type { DeliverableRegion } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

vi.mock("react-native", async () => (await import("./work.test-support")).reactNativeDom);
vi.mock("../../components/ui/AppText", async () => {
  const { reactNativeDom } = await import("./work.test-support");
  return { AppText: reactNativeDom.Text };
});
vi.mock("../../components/ui/Button", () => ({
  Button: (props: { label: string; disabled?: boolean; onPress: () => void }) => (
    <button type="button" disabled={props.disabled} onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));

import { drag, layout, resetWorkTestDom } from "./work.test-support";
import { RegionDrawBar, RegionDrawSurface } from "./WorkRegionDraw";

const SURFACE = "Mark an area";

function mount(initial: DeliverableRegion | null) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetWorkTestDom();
  const changes: DeliverableRegion[] = [];
  function Harness() {
    const [region, setRegion] = useState(initial);
    return (
      <RegionDrawSurface
        region={region}
        onChange={(next) => {
          changes.push(next);
          setRegion(next);
        }}
      />
    );
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  // A 16:9 frame letterboxed on a phone: the surface is laid exactly over it.
  act(() => layout(SURFACE, { width: 320, height: 180 }));
  return {
    changes,
    last: () => {
      const region = changes.at(-1);
      return region === undefined
        ? null
        : Object.fromEntries(
            Object.entries(region).map(([key, value]) => [key, Math.round(value * 100) / 100]),
          );
    },
    [Symbol.dispose]: () => act(() => root.unmount()),
  };
}

it("boxes the area a finger drags out, in fractions of the frame", () => {
  using surface = mount(null);
  act(() => drag(SURFACE, [32, 18], [100, 60], [160, 90]));
  expect(surface.changes).toHaveLength(1);
  expect(surface.last()).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
});

it("ignores a tap, so a stray touch never replaces the box", () => {
  using surface = mount({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  act(() => drag(SURFACE, [300, 170]));
  expect(surface.changes).toEqual([]);
});

it("moves the box when dragged from inside it and resizes it from a corner", () => {
  using surface = mount({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  // From the middle of the box, 64 points right and 18 down.
  act(() => drag(SURFACE, [96, 54], [160, 72]));
  expect(surface.last()).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.4 });
  // Its bottom right corner is now at (224, 108); pull it out to (288, 162).
  act(() => drag(SURFACE, [226, 110], [288, 162]));
  expect(surface.last()).toEqual({ x: 0.3, y: 0.2, w: 0.6, h: 0.7 });
});

it("keeps a box drawn past the frame's edge inside the frame", () => {
  using surface = mount(null);
  act(() => drag(SURFACE, [160, 90], [400, 300]));
  expect(surface.last()).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
});

it("offers Clear and Use area only once there is a box", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDone = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  using _root = { [Symbol.dispose]: () => act(() => root.unmount()) };
  const render = (hasRegion: boolean) =>
    act(() =>
      root.render(
        <RegionDrawBar
          noun="slide"
          hasRegion={hasRegion}
          onClear={() => {}}
          onCancel={() => {}}
          onDone={onDone}
        />,
      ),
    );
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;

  render(false);
  expect(container.textContent).toContain("Drag on the slide to box the area");
  expect(button("Clear").disabled).toBe(true);
  expect(button("Use area").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(false);

  render(true);
  expect(button("Clear").disabled).toBe(false);
  act(() => button("Use area").click());
  expect(onDone).toHaveBeenCalledOnce();
});
