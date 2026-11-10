import type { DeliverableRegion } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

import { IconButton } from "../../components/ui/IconButton";
import { MediaFrame, MediaStage, RegionOutline } from "./WorkMediaStage";
import { RegionDrawBar, RegionDrawSurface } from "./WorkRegionDraw";

/** Marking an area on the stage for the next note: the box in progress and the ways to end it. */
export interface StageMarking {
  /** False on a connection that can't leave notes: the stage then offers no way to mark. */
  readonly available: boolean;
  /** Set while the user is marking; its region is the box so far. */
  readonly session: { readonly region: DeliverableRegion | null } | null;
  /** The area already pinned to the note being written. */
  readonly attached: DeliverableRegion | null;
  readonly onStart: () => void;
  readonly onChange: (region: DeliverableRegion) => void;
  readonly onClear: () => void;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}

/**
 * A frame, slide or video pinned above the notes, with its controls in a row below. While an
 * area is being marked the frame takes the finger and the row becomes the marking controls.
 */
export function WorkStage(props: {
  readonly aspect: number;
  /** `frame`, `slide` or `page`: what the marking hint calls the thing being drawn on. */
  readonly noun: string;
  /** Where the selected note points, shown when nothing is being marked. */
  readonly highlight: DeliverableRegion | null;
  readonly marking: StageMarking;
  readonly children: ReactNode;
  readonly controls: ReactNode;
}) {
  const { marking } = props;
  const { height } = useWindowDimensions();
  // While typing, the stage gives its room to the note: a smaller frame and no controls row.
  const typing = useKeyboardState((state) => state.isVisible) && marking.session === null;
  const shown = props.highlight ?? marking.attached;
  return (
    <View>
      <MediaStage className="items-center rounded-none">
        <MediaFrame
          aspect={props.aspect}
          maxHeight={Math.round(height * (typing ? 0.22 : 0.42))}
          overlay={
            marking.session !== null ? (
              <RegionDrawSurface region={marking.session.region} onChange={marking.onChange} />
            ) : shown !== null ? (
              <RegionOutline region={shown} />
            ) : null
          }
        >
          {props.children}
        </MediaFrame>
      </MediaStage>
      {marking.session !== null ? (
        <RegionDrawBar
          noun={props.noun}
          hasRegion={marking.session.region !== null}
          onClear={marking.onClear}
          onCancel={marking.onCancel}
          onDone={marking.onDone}
        />
      ) : typing ? null : (
        props.controls
      )}
    </View>
  );
}

/** Starts marking an area; filled once an area is pinned to the note being written. */
export function MarkAreaButton(props: { readonly marking: StageMarking }) {
  const attached = props.marking.attached !== null;
  if (!props.marking.available) return null;
  return (
    <IconButton
      icon="pencil"
      variant={attached ? "primary" : "tonal"}
      accessibilityLabel={attached ? "Change the marked area" : "Mark an area for a note"}
      onPress={props.marking.onStart}
    />
  );
}
