import type { DeliverableRegion, DeliverableRendition } from "@t3tools/contracts";
import { useRef } from "react";

import { CaptureTools, type CaptureToolsProps } from "./CaptureTools";
import { DrawOverlay, type Drawing } from "./DrawOverlay";
import { MediaStage } from "./MediaStage";
import { RegionOutline } from "./RegionOutline";
import { useContainedBox } from "./useContainedBox";

/** An image deliverable, or anything with one rendered frame: the frame, large, to draw on. */
export function StillCanvas(
  props: CaptureToolsProps & {
    readonly rendition: DeliverableRendition;
    readonly highlight: DeliverableRegion | null;
    readonly drawing: boolean;
    readonly assetUrl: (url: string | null) => string | null;
    readonly onDrawDone: (drawing: Drawing) => void;
    readonly onDrawCancel: () => void;
  },
) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const { rendition } = props;
  const aspect =
    rendition.width !== null && rendition.height !== null && rendition.height > 0
      ? rendition.width / rendition.height
      : 4 / 3;
  const [boxRef, box] = useContainedBox(aspect);
  const unit = rendition.units[0];
  const src = props.assetUrl(unit?.imageUrl ?? rendition.posterUrl ?? rendition.sourceUrl);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <MediaStage style={box === null ? { width: "100%", aspectRatio: aspect } : box}>
          {src === null ? null : (
            <img ref={imageRef} src={src} alt="" className="size-full object-contain" />
          )}
          {props.highlight !== null && !props.drawing ? (
            <RegionOutline region={props.highlight} />
          ) : null}
          {props.drawing ? (
            <DrawOverlay
              source={() => {
                const element = imageRef.current;
                return element === null || element.naturalWidth === 0
                  ? null
                  : { element, width: element.naturalWidth, height: element.naturalHeight };
              }}
              onDone={props.onDrawDone}
              onCancel={props.onDrawCancel}
            />
          ) : null}
        </MediaStage>
      </div>
      <div className="flex shrink-0 items-center justify-end pt-2 pb-1">
        <CaptureTools
          talking={props.talking}
          talkAvailable={props.talkAvailable}
          onTalk={props.onTalk}
          onDraw={props.onDraw}
        />
      </div>
    </div>
  );
}
