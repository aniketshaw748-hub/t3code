import type { TimelineShot } from "./perceptualDiff.ts";

/** Cut times ffmpeg's `showinfo` printed for frames the scene filter selected. */
export function parseSceneCuts(stderr: string): ReadonlyArray<number> {
  const cuts: number[] = [];
  for (const match of stderr.matchAll(/Parsed_showinfo[^\n]*\bpts_time:\s*([0-9.]+)/g)) {
    const t = Number(match[1]);
    if (Number.isFinite(t)) cuts.push(t);
  }
  return cuts.sort((a, b) => a - b);
}

/** Shots between cuts, folding cuts closer than `minShotSeconds` into the shot before them. */
export function shotsFromCuts(
  cuts: ReadonlyArray<number>,
  duration: number,
  minShotSeconds = 0.5,
): ReadonlyArray<TimelineShot> {
  const bounds = [0];
  for (const cut of cuts) {
    if (cut - bounds.at(-1)! >= minShotSeconds && duration - cut >= minShotSeconds)
      bounds.push(cut);
  }
  bounds.push(duration);
  return bounds.slice(0, -1).map((start, index) => ({ index, start, end: bounds[index + 1]! }));
}

export interface ProbedMedia {
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly hasVideo: boolean;
}

/** `ffprobe -show_entries format=duration:stream=codec_type,width,height -of json`. */
export function parseProbe(json: string): ProbedMedia | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { format, streams } = parsed as {
    readonly format?: { readonly duration?: unknown };
    readonly streams?: ReadonlyArray<{
      readonly codec_type?: unknown;
      readonly width?: unknown;
      readonly height?: unknown;
    }>;
  };
  const video = streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(format?.duration);
  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    hasVideo: video !== undefined,
  };
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name.replace(":", "\\:")}="([^"]*)"`).exec(tag)?.[1];

/** Slide part paths in presentation order, from `ppt/presentation.xml` and its relationships. */
export function pptxSlideOrder(presentationXml: string, relationshipsXml: string): string[] {
  const targets = new Map<string, string>();
  for (const [tag] of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id !== undefined && target !== undefined) targets.set(id, target);
  }
  const slides: string[] = [];
  for (const [tag] of presentationXml.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = targets.get(attribute(tag, "r:id") ?? "");
    if (target === undefined) continue;
    slides.push(target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\//, "")}`);
  }
  return slides;
}

/** Targets a slide part references (images, media, layouts), resolved against `ppt/slides/`. */
export function pptxSlideReferences(slidePath: string, relationshipsXml: string): string[] {
  const directory = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const references: string[] = [];
  for (const [tag] of relationshipsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attribute(tag, "TargetMode") === "External") continue;
    const target = attribute(tag, "Target");
    if (target === undefined) continue;
    const parts = target.startsWith("/")
      ? target.slice(1).split("/")
      : [...directory.split("/"), ...target.split("/")];
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") resolved.pop();
      else if (part !== "." && part !== "") resolved.push(part);
    }
    references.push(resolved.join("/"));
  }
  return references.sort();
}

const decodeXmlText = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** The slide's first run of text, usually its title. */
export function pptxSlideTitle(slideXml: string): string | undefined {
  for (const match of slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
    const text = decodeXmlText(match[1]!).trim();
    if (text.length > 0) return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  }
  return undefined;
}
