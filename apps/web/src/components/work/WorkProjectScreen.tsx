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
import { notePinAnchor, notePinLabel, renditionMeta } from "@t3tools/client-runtime/work/anchors";
import type { NoteCheckTarget } from "@t3tools/client-runtime/work/notes";
import {
  notesFromFailedRun,
  primaryDeliverable,
  workRunFailure,
} from "@t3tools/client-runtime/work/shelf";
import { historyAvailability, versionStrip } from "@t3tools/client-runtime/work/versions";
import {
  AuthOrchestrationOperateScope,
  type DeliverableAnchor,
  type DeliverableId,
  type DeliverableNote,
  type DeliverableVersionId,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { formatWholeDeliverableMessage } from "@t3tools/shared/deliverableNotes";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { CompareView } from "./CompareView";
import { DeckCanvas } from "./DeckCanvas";
import { DeleteWorkProject } from "./DeleteWorkProject";
import type { Drawing } from "./DrawOverlay";
import { NotesPanel, type NotesTab } from "./NotesPanel";
import { RenderFailureBanner } from "./RenderFailureBanner";
import { SelfCheckBadge } from "./SelfCheckBadge";
import { StillCanvas } from "./StillCanvas";
import { StrayFileBanner } from "./StrayFileBanner";
import { useSendNotes, useSendWorkMessage } from "./useWorkActions";
import {
  isThreadBusy,
  useAgentProgress,
  useRendition,
  useThreadMessages,
  useWorkAssetUrl,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { RunFailureBanner } from "./RunFailureBanner";
import { VersionStrip } from "./VersionStrip";
import { VideoStage, type SeekRequest } from "./VideoStage";
import { WhatChanged } from "./WhatChanged";

const NO_NOTES: ReadonlyArray<DeliverableNote> = [];
const NO_SPEND_APPROVALS: ReadonlyArray<SpendApprovalItem> = [];

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
  const failure = workRunFailure(thread?.source);
  const failedNotes = notesFromFailedRun(notes, failure);
  // Read only after a failure, so a healthy project opens no message subscription for it.
  const failedRequest =
    useThreadMessages(
      failure === null || thread === null ? null : scopeThreadRef(environmentId, thread.id),
    ).findLast((message) => message.role === "user")?.text ?? null;
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

  const pinTarget = {
    kind,
    playheadSeconds: playhead,
    selectedSlide,
    region: drawing?.region ?? null,
  };
  const pinLabel = notePinLabel(pinTarget);

  /** A drawing always pins: it marks a place, so it is a note even with "Whole deck" chosen. */
  const pinnedAnchor = (): DeliverableAnchor | null =>
    notePinAnchor(pinTarget, pinned || drawing !== null);

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

  const sendNotesNow = async (toSend: ReadonlyArray<DeliverableNote>) => {
    if (deliverable === null || viewed === null || toSend.length === 0) return false;
    setSending(true);
    // The server gives the agent each note's picture with the message; none is uploaded here.
    const sent = await sendNotes({
      environmentId,
      projectId,
      thread,
      deliverable,
      version: viewed,
      notes: toSend,
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
    await sendNotesNow([created.value]);
  };

  /** Sends the failed run's notes again, or else the message that started it. */
  const retry =
    failedNotes.length > 0
      ? () => void sendNotesNow(failedNotes)
      : failedRequest !== null && failedRequest.trim().length > 0
        ? async () => {
            setSending(true);
            await sendMessage({ environmentId, projectId, thread, text: failedRequest });
            setSending(false);
          }
        : null;

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

  const meta = renditionMeta(kind, rendition);

  const canvas = (() => {
    if (snapshot === null) return <CanvasMessage busy title="Loading…" />;
    if (deliverable === null || viewed === null) {
      return busy ? (
        <CanvasMessage
          busy
          title={`The agent is drafting${progress.step === null ? "" : ` · ${progress.step.toLowerCase()}`}`}
        >
          The first version appears here when it saves one.
        </CanvasMessage>
      ) : (
        <CanvasMessage title="Nothing here yet">
          Tell the agent what to make in Notes & chat.
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
    if (rendition === null) return <CanvasMessage busy title={`Loading V${viewed.ordinal}…`} />;
    // A video plays from its original while its frames and proxy render, or if they failed.
    const rendered = rendition.status === "ready";
    if (!rendered && kind !== "video") {
      return rendition.status === "pending" || rendition.status === "rendering" ? (
        <CanvasMessage busy title={`Rendering V${viewed.ordinal}…`} />
      ) : (
        <CanvasMessage title={`No preview of V${viewed.ordinal}`} />
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
      <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back to the shelf"
            render={<Link to="/work" />}
          >
            <ChevronLeftIcon />
          </Button>
          <h1 className="min-w-[6ch] truncate text-sm font-medium">
            {project?.title ?? "Project"}
          </h1>
          {deliverables.length > 1 ? (
            <div className="min-w-0 shrink overflow-x-auto">
              <ToggleGroup
                aria-label="Deliverable"
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
            </div>
          ) : null}
          {viewed !== null ? (
            <Badge variant={viewed.id === currentVersionId ? "secondary" : "warning"}>
              V{viewed.ordinal}
              {viewed.id === currentVersionId ? " · current" : " · earlier version"}
            </Badge>
          ) : null}
          {meta ? (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{meta}</span>
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
          <DeleteWorkProject
            environmentId={environmentId}
            projectId={projectId}
            title={project?.title ?? "Project"}
            canOperate={canOperate}
          />
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section
            aria-label="Work"
            className="flex min-h-0 min-w-0 flex-col max-lg:h-[46dvh] max-lg:shrink-0 lg:flex-1"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1 pb-3">
              {failure !== null ? (
                <RunFailureBanner
                  failure={failure}
                  canOperate={canOperate}
                  retrying={sending}
                  onRetry={retry === null ? null : () => void retry()}
                  onShowChat={() => setTab("chat")}
                />
              ) : null}
              {viewed !== null &&
              rendition !== null &&
              (rendition.status === "failed" || rendition.status === "unsupported") ? (
                <RenderFailureBanner
                  environmentId={environmentId}
                  version={viewed}
                  rendition={rendition}
                  canOperate={canOperate}
                />
              ) : null}
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
            projectNotes={snapshot?.notes ?? NO_NOTES}
            versions={versions}
            thread={thread}
            failure={failure}
            failedNotes={failedNotes}
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
                <p className="text-sm text-muted-foreground">No versions yet.</p>
              ) : (
                <WhatChanged
                  environmentId={environmentId}
                  kind={kind}
                  version={viewed}
                  parent={versions.find((version) => version.id === viewed.parentVersionId) ?? null}
                  rendition={rendition}
                  onUnit={(place) => {
                    setViewedVersionId(
                      place.versionId === currentVersionId ? null : place.versionId,
                    );
                    focusAnchor(place.anchor);
                  }}
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

/** What the stage shows while there is no work on it: a plain line, with a spinner when waiting. */
function CanvasMessage(props: {
  readonly title: string;
  readonly busy?: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 rounded-xl border border-dashed border-border">
      <Empty size="compact">
        <EmptyHeader>
          {props.busy ? <Spinner size="md" tone="muted" className="mb-3" aria-hidden /> : null}
          <EmptyTitle>{props.title}</EmptyTitle>
          {props.children ? <EmptyDescription>{props.children}</EmptyDescription> : null}
        </EmptyHeader>
      </Empty>
    </div>
  );
}
