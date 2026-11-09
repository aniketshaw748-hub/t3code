import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  defaultCompareSelection,
  orderedCompare,
  pickCompareVersion,
  type CompareSelection,
} from "@t3tools/client-runtime/work/compare";
import type { NoteCheckTarget } from "@t3tools/client-runtime/work/notes";
import { primaryDeliverable } from "@t3tools/client-runtime/work/shelf";
import { historyAvailability, versionStrip } from "@t3tools/client-runtime/work/versions";
import {
  AuthOrchestrationOperateScope,
  type DeliverableAnchor,
  type DeliverableId,
  type DeliverableNote,
  type DeliverableVersionId,
  type EnvironmentId,
  type ProjectId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { formatTimecode, formatWholeDeliverableMessage } from "@t3tools/shared/deliverableNotes";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { useTextFieldSpeech } from "../../speech/useTextFieldSpeech";
import { useProject, useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import type { SpendApprovalItem } from "../chat/SpendApprovalCard";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { CompareView } from "./CompareView";
import { DeckCanvas } from "./DeckCanvas";
import type { Drawing } from "./DrawOverlay";
import { NotesPanel, type NotesTab } from "./NotesPanel";
import { SelfCheckBadge } from "./SelfCheckBadge";
import { StillCanvas } from "./StillCanvas";
import { StrayFileBanner } from "./StrayFileBanner";
import { useSendNotes, useSendWorkMessage } from "./useWorkActions";
import {
  isThreadBusy,
  useAgentProgress,
  useRendition,
  useWorkAssetUrl,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { VersionStrip } from "./VersionStrip";
import { VideoStage, type SeekRequest } from "./VideoStage";
import { WhatChanged } from "./WhatChanged";

const NO_SPEND_APPROVALS: ReadonlyArray<SpendApprovalItem> = [];

function snapshotAttachment(dataUrl: string): UploadChatAttachment {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return {
    type: "image",
    name: "note-drawing.png",
    mimeType: "image/png",
    sizeBytes: (base64.length * 3) / 4 - padding,
    dataUrl,
  };
}

/** Reads a stored note snapshot back, so resending a note still shows the agent the drawing. */
async function fetchSnapshot(url: string): Promise<UploadChatAttachment | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return snapshotAttachment(dataUrl);
  } catch {
    return null;
  }
}

/** One Work project: the work itself as the canvas, its versions, and Notes & chat beside it. */
export function WorkProjectScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const snapshot = useWorkProjectSnapshot(environmentId, projectId);
  const thread = useWorkThreads(environmentId, projectId)[0] ?? null;
  const busy = isThreadBusy(thread);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const assetUrl = useWorkAssetUrl(environmentId);
  const projection = useQuietThreadProjection(
    thread === null ? null : scopeThreadRef(environmentId, thread.id),
  );

  const [chosenDeliverable, setChosenDeliverable] = useState<DeliverableId | null>(null);
  const [viewedVersionId, setViewedVersionId] = useState<DeliverableVersionId | null>(null);
  const [compare, setCompare] = useState<CompareSelection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const [selectedSlide, setSelectedSlide] = useState<number | null>(null);
  const [slideFocused, setSlideFocused] = useState(false);
  const [drawingActive, setDrawingActive] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [highlightNote, setHighlightNote] = useState<DeliverableNote | null>(null);
  const [tab, setTab] = useState<NotesTab>("notes");
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const speech = useTextFieldSpeech({
    environmentId,
    projectId,
    ownerKey: `work:${environmentId}:${projectId}`,
    text,
    textareaRef,
    onTextChange: setText,
    disabled: !canOperate,
  });

  const createNote = useAtomCommand(workEnvironment.createNote, { reportFailure: false });
  const undo = useAtomCommand(workEnvironment.undo, { reportFailure: false });
  const redo = useAtomCommand(workEnvironment.redo, { reportFailure: false });
  const restore = useAtomCommand(workEnvironment.restore, { reportFailure: false });
  const sendNotes = useSendNotes();
  const sendMessage = useSendWorkMessage();

  const deliverables = snapshot?.deliverables ?? [];
  const deliverable =
    deliverables.find((candidate) => candidate.id === chosenDeliverable) ??
    primaryDeliverable(deliverables);
  const versions = (snapshot?.versions ?? []).filter(
    (version) => version.deliverableId === deliverable?.id,
  );
  const strayOriginal =
    deliverables.find((candidate) => candidate.id === deliverable?.strayVersionOf) ?? null;
  const currentVersionId = deliverable?.currentVersionId ?? null;
  const viewed =
    versions.find((version) => version.id === (viewedVersionId ?? currentVersionId)) ??
    versions.find((version) => version.id === currentVersionId) ??
    null;
  const notes = (snapshot?.notes ?? []).filter((note) => note.deliverableId === deliverable?.id);
  const rendition = useRendition(
    environmentId,
    viewed?.id ?? null,
    viewed?.renditionStatus ?? null,
  );
  const kind = deliverable?.kind ?? "other";
  const history = historyAvailability({
    versions,
    currentVersionId,
    turnRunning: busy,
    canOperate,
    pending: historyPending,
  });
  const comparePair = compare === null ? null : orderedCompare(compare, versions);
  const progress = useAgentProgress(
    busy && thread !== null ? scopeThreadRef(environmentId, thread.id) : null,
  );
  const workingSlide =
    progress.step !== null && /^(Slide|Page) /.test(progress.step)
      ? Number(progress.step.split(" ")[1]) - 1
      : null;
  const spendApprovals =
    projection?.projection.turnItems.flatMap((item) =>
      item.type === "spend_approval" && item.approvalStatus === "pending" ? [item] : [],
    ) ?? NO_SPEND_APPROVALS;

  const pinLabel =
    kind === "video"
      ? formatTimecode(playhead)
      : (kind === "deck" || kind === "pdf") && selectedSlide !== null
        ? `${kind === "pdf" ? "Page" : "Slide"} ${selectedSlide + 1}`
        : drawing !== null
          ? "the drawing"
          : null;

  /** A drawing always pins: it marks a place, so it is a note even with "Whole deck" chosen. */
  const pinnedAnchor = (): DeliverableAnchor | null => {
    const region = drawing?.region;
    if ((!pinned && drawing === null) || pinLabel === null) return null;
    if (kind === "video") {
      return region === undefined
        ? { kind: "time", t: playhead }
        : { kind: "time", t: playhead, region };
    }
    if ((kind === "deck" || kind === "pdf") && selectedSlide !== null) {
      return region === undefined
        ? { kind: "slide", index: selectedSlide }
        : { kind: "slide", index: selectedSlide, region };
    }
    return region === undefined ? null : { kind: "region", ...region };
  };

  const seekTo = (seconds: number) => setSeek({ seconds, nonce: Date.now() });

  const focusAnchor = (anchor: DeliverableAnchor | null) => {
    if (anchor === null) return;
    if (anchor.kind === "time") seekTo(anchor.t);
    if (anchor.kind === "slide") {
      setSelectedSlide(anchor.index);
      setSlideFocused(anchor.region !== undefined);
    }
  };

  const onCheck = (check: NoteCheckTarget) => {
    setCompare(null);
    setViewedVersionId(check.versionId === currentVersionId ? null : check.versionId);
    focusAnchor(check.anchor);
  };

  const sendNotesNow = async (
    toSend: ReadonlyArray<DeliverableNote>,
    snapshots?: ReadonlyArray<UploadChatAttachment>,
  ) => {
    if (deliverable === null || viewed === null || toSend.length === 0) return false;
    setSending(true);
    const attachments =
      snapshots ??
      (
        await Promise.all(
          toSend.map((note) => {
            const url = assetUrl(note.snapshotUrl);
            return url === null ? null : fetchSnapshot(url);
          }),
        )
      ).filter((attachment) => attachment !== null);
    const sent = await sendNotes({
      environmentId,
      projectId,
      thread,
      deliverable,
      version: viewed,
      notes: toSend,
      snapshots: attachments,
    });
    setSending(false);
    return sent;
  };

  const onSend = async () => {
    const body = text.trim();
    if (body.length === 0 || sending) return;
    if (deliverable === null || viewed === null) {
      // Nothing to pin a note to yet: this is a plain message to the agent.
      setSending(true);
      const sent = await sendMessage({ environmentId, projectId, thread, text: body });
      setSending(false);
      if (sent !== null) setText("");
      return;
    }
    const anchor = pinnedAnchor();
    if (anchor === null) {
      // About the whole deliverable: a chat message to the agent, with nothing to track.
      setSending(true);
      const sent = await sendMessage({
        environmentId,
        projectId,
        thread,
        text: formatWholeDeliverableMessage({ deliverable, versionOrdinal: viewed.ordinal, body }),
      });
      setSending(false);
      if (sent !== null) setText("");
      return;
    }
    setSending(true);
    const snapshotDataUrl = drawing?.snapshotDataUrl ?? null;
    const created = await createNote({
      environmentId,
      input: {
        deliverableId: deliverable.id,
        versionId: viewed.id,
        anchor,
        body,
        ...(snapshotDataUrl === null ? {} : { snapshotDataUrl }),
      },
    });
    setSending(false);
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        const error = squashAtomCommandFailure(created);
        toastManager.add({
          type: "error",
          title: "Could not save the note",
          description: error instanceof Error ? error.message : undefined,
        });
      }
      return;
    }
    setText("");
    setDrawing(null);
    await sendNotesNow(
      [created.value],
      snapshotDataUrl === null ? undefined : [snapshotAttachment(snapshotDataUrl)],
    );
  };

  const moveHistory = async (
    action: "undo" | "redo" | { readonly restore: DeliverableVersionId },
  ) => {
    if (deliverable === null) return;
    setHistoryPending(true);
    const target = { environmentId, input: { deliverableId: deliverable.id } };
    const result =
      action === "undo"
        ? await undo(target)
        : action === "redo"
          ? await redo(target)
          : await restore({
              environmentId,
              input: { deliverableId: deliverable.id, versionId: action.restore },
            });
    setHistoryPending(false);
    if (result._tag === "Success") {
      setViewedVersionId(null);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not change the version",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const talk = () => {
    if (speech.state.phase === "recording") {
      void speech.stop();
      return;
    }
    setTab("notes");
    textareaRef.current?.focus();
    void speech.start();
  };

  const onDrawDone = (next: Drawing) => {
    setDrawing(next);
    setDrawingActive(false);
    setTab("notes");
    textareaRef.current?.focus();
  };

  const highlight =
    highlightNote?.anchor?.kind === "region"
      ? highlightNote.anchor
      : (highlightNote?.anchor?.region ?? drawing?.region ?? null);

  const meta =
    rendition === null
      ? null
      : kind === "video"
        ? [
            rendition.durationSeconds === null ? null : formatTimecode(rendition.durationSeconds),
            rendition.height === null ? null : `${rendition.height}p`,
          ]
            .filter((part) => part !== null)
            .join(" · ")
        : kind === "deck" || kind === "pdf"
          ? `${rendition.units.length} ${kind === "pdf" ? "pages" : "slides"}`
          : null;

  const canvas = (() => {
    if (snapshot === null) return <CanvasMessage>Loading…</CanvasMessage>;
    if (deliverable === null || viewed === null) {
      return (
        <CanvasMessage>
          {busy
            ? `The agent is drafting${progress.step === null ? "" : ` · ${progress.step.toLowerCase()}`}. The first version appears here when it saves one.`
            : "Nothing here yet. Tell the agent what to make in Notes & chat."}
        </CanvasMessage>
      );
    }
    if (comparePair !== null) {
      return (
        <CompareView
          environmentId={environmentId}
          kind={kind}
          base={comparePair.base}
          target={comparePair.target}
          assetUrl={assetUrl}
          onRestoreBase={
            history.restoreBlockedReason === null && comparePair.base.id !== currentVersionId
              ? () => void moveHistory({ restore: comparePair.base.id })
              : null
          }
        />
      );
    }
    if (rendition === null) return <CanvasMessage>Loading V{viewed.ordinal}…</CanvasMessage>;
    // A video plays from its original while its frames and proxy render, or if they failed.
    const rendered = rendition.status === "ready";
    if (!rendered && kind !== "video") {
      return (
        <CanvasMessage>
          {rendition.status === "pending" || rendition.status === "rendering"
            ? `Rendering V${viewed.ordinal}…`
            : (rendition.detail ?? `V${viewed.ordinal} could not be rendered.`)}
        </CanvasMessage>
      );
    }
    const shared = {
      drawing: drawingActive,
      talking: speech.state.phase === "recording",
      talkAvailable: speech.available,
      onTalk: talk,
      onDraw: () => setDrawingActive(true),
      onDrawDone,
      onDrawCancel: () => setDrawingActive(false),
    };
    if (kind === "video") {
      return (
        <VideoStage
          {...shared}
          sourceUrl={assetUrl(rendition.sourceUrl)}
          posterUrl={assetUrl(rendition.posterUrl)}
          aspect={
            rendition.width !== null && rendition.height !== null && rendition.height > 0
              ? rendition.width / rendition.height
              : 16 / 9
          }
          durationSeconds={rendition.durationSeconds}
          notes={notes}
          seek={seek}
          highlight={highlight}
          onTime={setPlayhead}
          onMarker={(marker) => {
            setHighlightNote(notes.find((note) => note.id === marker.noteIds[0]) ?? null);
            setTab("notes");
          }}
        />
      );
    }
    if (kind === "deck" || kind === "pdf") {
      return (
        <DeckCanvas
          {...shared}
          rendition={rendition}
          notes={notes}
          selectedSlide={selectedSlide}
          focused={slideFocused}
          workingSlide={workingSlide}
          highlight={highlight}
          assetUrl={assetUrl}
          onSelectSlide={(index) => {
            setSelectedSlide(index);
            setHighlightNote(null);
            if (index === null) setSlideFocused(false);
          }}
          onFocus={setSlideFocused}
          onDraw={() => {
            if (selectedSlide === null) setSelectedSlide(rendition.units[0]?.index ?? 0);
            setDrawingActive(true);
          }}
        />
      );
    }
    return (
      <StillCanvas {...shared} rendition={rendition} highlight={highlight} assetUrl={assetUrl} />
    );
  })();

  const viewingOld = viewed !== null && viewed.id !== currentVersionId && comparePair === null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col bg-work-canvas text-work-ink">
        <WorkspacePageHeader electron={isElectron}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to the shelf"
            render={<Link to="/work" />}
          >
            <ChevronLeftIcon />
          </Button>
          <h1 className="min-w-0 truncate text-sm font-medium">{project?.title ?? "Project"}</h1>
          {deliverables.length > 1 ? (
            <ToggleGroup
              aria-label="Deliverable"
              variant="segmented"
              value={deliverable === null ? [] : [deliverable.id]}
              onValueChange={(next) => {
                const id = next[0];
                if (id === undefined) return;
                setChosenDeliverable(id as DeliverableId);
                setViewedVersionId(null);
                setCompare(null);
                setSelectedSlide(null);
              }}
            >
              {deliverables.map((candidate) => (
                <Toggle key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </Toggle>
              ))}
            </ToggleGroup>
          ) : null}
          {viewed !== null ? (
            <span className="shrink-0 rounded-md bg-work-raised px-1.5 py-0.5 font-mono text-2xs ring-1 ring-work-line">
              V{viewed.ordinal}
              {viewed.id === currentVersionId ? " · current" : ""}
            </span>
          ) : null}
          {meta ? (
            <span className="hidden shrink-0 text-xs text-work-muted sm:inline">{meta}</span>
          ) : null}
          {viewed?.selfCheck ? <SelfCheckBadge result={viewed.selfCheck} /> : null}
          <span className="flex-1" />
          {viewingOld ? (
            <>
              <Button variant="ghost" size="xs" onClick={() => setViewedVersionId(null)}>
                Back to current
              </Button>
              <Button
                variant="outline"
                size="xs"
                aria-disabled={history.restoreBlockedReason !== null || undefined}
                title={history.restoreBlockedReason ?? undefined}
                onClick={
                  history.restoreBlockedReason === null && viewed !== null
                    ? () => void moveHistory({ restore: viewed.id })
                    : undefined
                }
              >
                <RotateCcwIcon />
                Restore V{viewed?.ordinal}
              </Button>
            </>
          ) : null}
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section aria-label="Work" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              {deliverable !== null && strayOriginal !== null ? (
                <StrayFileBanner
                  environmentId={environmentId}
                  stray={deliverable}
                  original={strayOriginal}
                  canOperate={canOperate}
                  turnRunning={busy}
                />
              ) : null}
              {canvas}
            </div>
            {versions.length > 0 ? (
              <VersionStrip
                items={versionStrip(versions, currentVersionId)}
                history={history}
                viewedVersionId={viewed?.id ?? null}
                compared={compare === null ? null : new Set([compare.first, compare.second])}
                onView={(versionId) => {
                  if (compare !== null) {
                    setCompare(pickCompareVersion(compare, versionId));
                    return;
                  }
                  setViewedVersionId(versionId === currentVersionId ? null : versionId);
                }}
                onUndo={() => void moveHistory("undo")}
                onRedo={() => void moveHistory("redo")}
                onToggleCompare={() =>
                  setCompare(
                    compare === null
                      ? defaultCompareSelection(versions, viewed?.id ?? currentVersionId)
                      : null,
                  )
                }
              />
            ) : null}
          </section>
          <NotesPanel
            environmentId={environmentId}
            deliverable={deliverable}
            notes={notes}
            versions={versions}
            thread={thread}
            spendApprovals={spendApprovals}
            pinLabel={pinLabel}
            composer={{
              text,
              setText,
              speech,
              pinned,
              setPinned,
              drawing,
              clearDrawing: () => setDrawing(null),
            }}
            composerRef={textareaRef}
            sending={sending}
            canOperate={canOperate}
            tab={tab}
            onTab={setTab}
            changes={
              deliverable === null || viewed === null ? (
                <p className="text-sm text-work-muted">No versions yet.</p>
              ) : (
                <WhatChanged
                  environmentId={environmentId}
                  kind={kind}
                  version={viewed}
                  parent={versions.find((version) => version.id === viewed.parentVersionId) ?? null}
                  rendition={rendition}
                  onUnit={(anchor) => focusAnchor(anchor)}
                  onCompare={() =>
                    setCompare(
                      viewed.parentVersionId === null
                        ? null
                        : { first: viewed.parentVersionId, second: viewed.id },
                    )
                  }
                />
              )
            }
            onSend={() => void onSend()}
            onSendNotes={(toSend) => void sendNotesNow(toSend)}
            onCheck={onCheck}
            onFocusNote={(note) => {
              setHighlightNote(note);
              setCompare(null);
              if (note.versionId !== viewed?.id && note.status !== "fixed") {
                setViewedVersionId(note.versionId === currentVersionId ? null : note.versionId);
              }
              focusAnchor(note.anchor);
            }}
          />
        </div>
      </div>
    </SidebarInset>
  );
}

function CanvasMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-work-line p-8 text-center">
      <p className="max-w-md text-sm text-work-muted">{children}</p>
    </div>
  );
}
