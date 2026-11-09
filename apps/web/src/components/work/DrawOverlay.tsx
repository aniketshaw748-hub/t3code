import type { DeliverableRegion } from "@t3tools/contracts";
import { CheckIcon, Undo2Icon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { strokesRegion, type StrokePoint } from "./workGeometry";

export interface Drawing {
  readonly region: DeliverableRegion;
  /** The frame with the drawing on it, as a PNG data URL; null when the frame can't be read. */
  readonly snapshotDataUrl: string | null;
}

const STROKE = "#ffffff";
const STROKE_SHADOW = "rgb(0 0 0 / 55%)";
const MAX_SNAPSHOT_WIDTH = 1600;

function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: ReadonlyArray<ReadonlyArray<StrokePoint>>,
  width: number,
  height: number,
) {
  const lineWidth = Math.max(2, width / 320);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const [color, extra] of [
    [STROKE_SHADOW, lineWidth * 1.2],
    [STROKE, 0],
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = lineWidth + extra;
    for (const stroke of strokes) {
      context.beginPath();
      stroke.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (stroke.length === 1) context.lineTo(stroke[0]!.x * width + 0.1, stroke[0]!.y * height);
      context.stroke();
    }
  }
}

/** Composites the frame and the drawing at the source's resolution, capped for upload size. */
function snapshot(
  source: CanvasImageSource,
  sourceSize: { readonly width: number; readonly height: number },
  strokes: ReadonlyArray<ReadonlyArray<StrokePoint>>,
): string | null {
  const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / Math.max(1, sourceSize.width));
  const width = Math.round(sourceSize.width * scale);
  const height = Math.round(sourceSize.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  try {
    context.drawImage(source, 0, 0, width, height);
    drawStrokes(context, strokes, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    // A frame served from another origin taints the canvas; the region still records.
    return null;
  }
}

/**
 * Freehand drawing over a frame or slide. Strokes paint straight to a canvas, so drawing never
 * re-renders React; Done hands back the region around them and a snapshot with them on it.
 */
export function DrawOverlay(props: {
  /** The video or image under the overlay, read for the snapshot. */
  readonly source: () => {
    readonly element: CanvasImageSource;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly onDone: (drawing: Drawing) => void;
  readonly onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<StrokePoint[][]>([]);
  const drawing = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);

  const repaint = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * ratio)) {
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(context, strokes.current, canvas.width, canvas.height);
  };

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const finish = () => {
    const region = strokesRegion(strokes.current);
    if (region === null) return;
    const source = props.source();
    props.onDone({
      region,
      snapshotDataUrl:
        source === null
          ? null
          : snapshot(
              source.element,
              { width: source.width, height: source.height },
              strokes.current,
            ),
    });
  };

  return (
    <div className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        aria-label="Draw on the frame"
        className="size-full cursor-crosshair touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          strokes.current.push([pointAt(event)]);
          repaint();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          strokes.current.at(-1)?.push(pointAt(event));
          repaint();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setStrokeCount(strokes.current.length);
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/75 p-1 text-white shadow-lg backdrop-blur">
        <span className="px-2 text-xs text-white/70">
          {strokeCount === 0 ? "Draw on the frame" : "Add a note, then send"}
        </span>
        <Button
          size="icon-xs"
          variant="overlay"
          aria-label="Undo last stroke"
          disabled={strokeCount === 0}
          onClick={() => {
            strokes.current.pop();
            setStrokeCount(strokes.current.length);
            repaint();
          }}
        >
          <Undo2Icon />
        </Button>
        <Button
          size="icon-xs"
          variant="overlay"
          aria-label="Cancel drawing"
          onClick={props.onCancel}
        >
          <XIcon />
        </Button>
        <Button size="xs" variant="media-close" disabled={strokeCount === 0} onClick={finish}>
          <CheckIcon />
          Done
        </Button>
      </div>
    </div>
  );
}
