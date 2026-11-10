import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  anchorRegion,
  notePinAnchor,
  notePinLabel,
  renditionMeta,
} from "@t3tools/client-runtime/work/anchors";
import {
  defaultCompareSelection,
  orderedCompare,
  pickCompareVersion,
  type CompareSelection,
} from "@t3tools/client-runtime/work/compare";
import { noteDisplay, sortNotes, type NoteCheckTarget } from "@t3tools/client-runtime/work/notes";
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
  type DeliverableNoteId,
  type DeliverableRegion,
  type DeliverableVersionId,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { formatWholeDeliverableMessage } from "@t3tools/shared/deliverableNotes";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useRef, useState } from "react";
import { Keyboard, ScrollView, View, type TextInputInstance } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useProject } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import { useSendNotes, useSendWorkMessage } from "./useWorkActions";
import {
  isThreadBusy,
  useAgentProgress,
  usePendingSpendApprovals,
  useRendition,
  useThreadMessages,
  useWorkAssetUrl,
  useWorkPendingRequests,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { WorkBanner } from "./WorkBanner";
import { WorkCompareView } from "./WorkCompareView";
import { renditionAspect, WorkSlideGrid, WorkSlideStage, WorkStillStage } from "./WorkDeckStage";
import { WorkNoteComposer } from "./WorkNoteComposer";
import { NoteCard, NotesSummary, WorkChatLog } from "./WorkNotes";
import {
  PendingRequestCards,
  RunFailureBanner,
  SpendApprovalCard,
  StrayFileBanner,
} from "./WorkRequests";
import type { StageMarking } from "./WorkStage";
import { WorkVersionStrip } from "./WorkVersionStrip";
import { WorkVideoStage, type SeekRequest } from "./WorkVideoStage";
import { WorkWhatChanged } from "./WorkWhatChanged";

export type WorkProjectParams = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
};

type Panel = "notes" | "changes";

export function WorkProjectRouteScreen({ route }: StaticScreenProps<WorkProjectParams>) {
  return (
    <WorkProjectScreen
      key={`${route.params.environmentId}:${route.params.projectId}`}
      environmentId={route.params.environmentId}
      projectId={route.params.projectId}
    />
  );
}

/** What the page shows in place of the work while there is none to show. */
function StageNotice(props: {
  readonly title: string;
  readonly detail?: string | null;
  readonly busy?: boolean;
}) {
  return (
    <View className="items-center gap-2 px-6 py-10">
      {props.busy ? <AppActivityIndicator /> : null}
      <Text className="text-center text-base font-t3-medium">{props.title}</Text>
      {props.detail ? (
        <Text className="text-center text-sm text-foreground-muted">{props.detail}</Text>
      ) : null}
    </View>
  );
}

/** One Work project on a phone: the work on top, its versions, then Notes & chat. */
function WorkProjectScreen(props: WorkProjectParams) {
  const { environmentId, projectId } = props;
  const navigation = useNavigation();
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const snapshot = useWorkProjectSnapshot(environmentId, projectId);
  const thread = useWorkThreads(environmentId, projectId)[0] ?? null;
  const threadRef = thread === null ? null : scopeThreadRef(environmentId, thread.id);
  const busy = isThreadBusy(thread);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const assetUrl = useWorkAssetUrl(environmentId);
  const spendApprovals = usePendingSpendApprovals(threadRef);
  const pendingRequests = useWorkPendingRequests(threadRef);
  const progress = useAgentProgress(busy ? threadRef : null);

  const [chosenDeliverable, setChosenDeliverable] = useState<DeliverableId | null>(null);
  const [viewedVersionId, setViewedVersionId] = useState<DeliverableVersionId | null>(null);
  const [compare, setCompare] = useState<CompareSelection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const [selectedSlide, setSelectedSlide] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<DeliverableNoteId | null>(null);
  // The area marked for the note being written, and the box in progress while marking one.
  const [region, setRegion] = useState<DeliverableRegion | null>(null);
  const [markSession, setMarkSession] = useState<StageMarking["session"]>(null);
  const [panel, setPanel] = useState<Panel>("notes");
  const [pinned, setPinned] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const inputRef = useRef<TextInputInstance | null>(null);

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
  const projectNotes = snapshot?.notes ?? [];
  const notes = projectNotes.filter((note) => note.deliverableId === deliverable?.id);
  const failure = workRunFailure(thread?.source);
  const failedNotes = notesFromFailedRun(notes, failure);
  // Read only after a failure, so a healthy project opens no message subscription for it.
  const failedRequest =
    useThreadMessages(failure === null ? null : threadRef).findLast(
      (message) => message.role === "user",
    )?.text ?? null;
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
  const workingSlide =
    progress.step !== null && /^(Slide|Page) /.test(progress.step)
      ? Number(progress.step.split(" ")[1]) - 1
      : null;
  const pinTarget = { kind, playheadSeconds: playhead, selectedSlide, region };
  const pinLabel = notePinLabel(pinTarget);
  const ordinalById = new Map(versions.map((version) => [version.id, version.ordinal]));
  const sorted = sortNotes(notes);
  const unsent = notes.filter((note) => note.status === "open" && note.sentMessageId === null);
  const noteMessageIds = new Set(
    projectNotes.flatMap((note) => (note.sentMessageId === null ? [] : [note.sentMessageId])),
  );
  const highlight = anchorRegion(notes.find((note) => note.id === highlighted)?.anchor ?? null);

  const openChat = () => {
    if (thread !== null) {
      navigation.dispatch(StackActions.push("Thread", { environmentId, threadId: thread.id }));
    }
  };

  /** A marked area belongs to the frame it was drawn on, so leaving the frame drops it. */
  const leaveFrame = () => {
    setRegion(null);
    setMarkSession(null);
  };

  const selectSlide = (index: number | null) => {
    if (index !== selectedSlide) leaveFrame();
    setSelectedSlide(index);
  };

  const viewVersion = (versionId: DeliverableVersionId | null) => {
    leaveFrame();
    setViewedVersionId(versionId === currentVersionId ? null : versionId);
  };

  const focusAnchor = (anchor: DeliverableAnchor | null) => {
    if (anchor === null) return;
    if (anchor.kind === "time") setSeek({ seconds: anchor.t, nonce: (seek?.nonce ?? 0) + 1 });
    if (anchor.kind === "slide") selectSlide(anchor.index);
  };

  const onCheck = (check: NoteCheckTarget) => {
    setCompare(null);
    viewVersion(check.versionId);
    focusAnchor(check.anchor);
  };

  const onFocusNote = (note: DeliverableNote) => {
    setCompare(null);
    if (note.versionId !== viewed?.id && note.status !== "fixed") viewVersion(note.versionId);
    focusAnchor(note.anchor);
    setHighlighted(note.id);
  };

  const marking: StageMarking = {
    available: canOperate,
    session: markSession,
    attached: region,
    onStart: () => {
      Keyboard.dismiss();
      setHighlighted(null);
      setMarkSession({ region });
    },
    onChange: (next) => setMarkSession({ region: next }),
    onClear: () => setMarkSession({ region: null }),
    onCancel: () => setMarkSession(null),
    onDone: () => {
      setRegion(markSession?.region ?? null);
      setMarkSession(null);
      inputRef.current?.focus();
    },
  };

  const sendNotesNow = async (toSend: ReadonlyArray<DeliverableNote>) => {
    if (deliverable === null || viewed === null || toSend.length === 0) return false;
    setSending(true);
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

  const sendChat = async (text: string) => {
    setSending(true);
    const sent = await sendMessage({ environmentId, projectId, thread, text });
    setSending(false);
    return sent !== null;
  };

  const onSend = async (body: string): Promise<boolean> => {
    if (sending) return false;
    // Nothing to pin a note to yet: this is a plain message to the agent.
    if (deliverable === null || viewed === null) return sendChat(body);
    // A marked area always pins: it points at a place, so it is a note even with "Whole" chosen.
    const anchor = notePinAnchor(pinTarget, pinned || region !== null);
    if (anchor === null) {
      // About the whole deliverable: a chat message to the agent, with nothing to track.
      return sendChat(
        formatWholeDeliverableMessage({ deliverable, versionOrdinal: viewed.ordinal, body }),
      );
    }
    setSending(true);
    const created = await createNote({
      environmentId,
      input: { deliverableId: deliverable.id, versionId: viewed.id, anchor, body },
    });
    setSending(false);
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        const error = squashAtomCommandFailure(created);
        Dialog.alert("Could not save the note", error instanceof Error ? error.message : undefined);
      }
      return false;
    }
    setRegion(null);
    setHighlighted(created.value.id);
    await sendNotesNow([created.value]);
    return true;
  };

  /** Sends the failed run's notes again, or else the message that started it. */
  const retry =
    failedNotes.length > 0
      ? () => void sendNotesNow(failedNotes)
      : failedRequest !== null && failedRequest.trim().length > 0
        ? () => void sendChat(failedRequest)
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
      viewVersion(null);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not change the version",
        error instanceof Error ? error.message : undefined,
      );
    }
  };

  const meta = renditionMeta(kind, rendition);
  const viewingOld = viewed !== null && viewed.id !== currentVersionId && comparePair === null;
  const subtitle =
    viewed === null
      ? null
      : [
          `V${viewed.ordinal} · ${viewed.id === currentVersionId ? "current" : "earlier version"}`,
          meta,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  const unitNoun = kind === "pdf" ? "Page" : "Slide";
  const showsWork = deliverable !== null && viewed !== null && comparePair === null;
  const rendered = rendition?.status === "ready";

  // The work stays above the scrolling notes, so the place a note points at is always in view.
  const stage =
    !showsWork || rendition === null ? null : kind === "video" ? (
      <WorkVideoStage
        // A video plays from its original while its frames and proxy render, or if they failed.
        sourceUrl={assetUrl(rendition.proxyUrl ?? rendition.sourceUrl)}
        aspect={renditionAspect(rendition, 16 / 9)}
        durationSeconds={rendition.durationSeconds}
        notes={notes}
        seek={seek}
        highlight={highlight}
        marking={marking}
        onTime={setPlayhead}
        onMarker={(marker) => {
          setHighlighted(marker.noteIds[0] ?? null);
          setPanel("notes");
        }}
      />
    ) : !rendered ? null : kind === "deck" || kind === "pdf" ? (
      selectedSlide === null ? null : (
        <WorkSlideStage
          rendition={rendition}
          noun={unitNoun}
          selectedSlide={selectedSlide}
          highlight={highlight}
          marking={marking}
          assetUrl={assetUrl}
          onSelectSlide={(index) => {
            setHighlighted(null);
            selectSlide(index);
          }}
        />
      )
    ) : (
      <WorkStillStage
        rendition={rendition}
        highlight={highlight}
        marking={marking}
        assetUrl={assetUrl}
      />
    );

  const work = (() => {
    if (snapshot === null) return <StageNotice busy title="Loading…" />;
    if (deliverable === null || viewed === null) {
      return busy ? (
        <StageNotice
          busy
          title={`The agent is drafting${progress.step === null ? "" : ` · ${progress.step.toLowerCase()}`}`}
          detail="The first version appears here when it saves one."
        />
      ) : (
        <StageNotice title="Nothing here yet" detail="Tell the agent what to make below." />
      );
    }
    if (comparePair !== null) {
      return (
        <WorkCompareView
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
    if (rendition === null) return <StageNotice busy title={`Loading V${viewed.ordinal}…`} />;
    if (kind === "video") return null;
    if (!rendered) {
      return rendition.status === "pending" || rendition.status === "rendering" ? (
        <StageNotice busy title={`Rendering V${viewed.ordinal}…`} />
      ) : (
        <StageNotice title={`V${viewed.ordinal} could not be rendered`} detail={rendition.detail} />
      );
    }
    if (kind === "deck" || kind === "pdf") {
      return (
        <WorkSlideGrid
          rendition={rendition}
          notes={notes}
          noun={unitNoun}
          selectedSlide={selectedSlide}
          workingSlide={workingSlide}
          assetUrl={assetUrl}
          onSelectSlide={(index) => {
            setHighlighted(null);
            selectSlide(index);
          }}
        />
      );
    }
    return null;
  })();

  return (
    <KeyboardAvoidingView automaticOffset behavior="height" className="flex-1 bg-screen">
      <AppBar
        title={project?.title ?? "Project"}
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        actions={
          thread === null
            ? undefined
            : [{ accessibilityLabel: "Open the full chat", icon: "text.bubble", onPress: openChat }]
        }
      />
      <ScreenContent surface="screen">
        {stage}
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerClassName="gap-4 px-4 pt-3 pb-6"
        >
          {deliverables.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityLabel="Deliverable"
              contentContainerClassName="gap-1.5"
            >
              {deliverables.map((candidate) => (
                <Chip
                  key={candidate.id}
                  label={candidate.title}
                  selected={candidate.id === deliverable?.id}
                  onPress={() => {
                    leaveFrame();
                    setChosenDeliverable(candidate.id);
                    setViewedVersionId(null);
                    setCompare(null);
                    setSelectedSlide(null);
                    setHighlighted(null);
                  }}
                />
              ))}
            </ScrollView>
          ) : null}
          {failure === null ? null : (
            <RunFailureBanner
              failure={failure}
              canOperate={canOperate}
              retrying={sending}
              onRetry={retry}
              onOpenChat={openChat}
            />
          )}
          {deliverable !== null && strayOriginal !== null ? (
            <StrayFileBanner
              environmentId={environmentId}
              stray={deliverable}
              original={strayOriginal}
              canOperate={canOperate}
              turnRunning={busy}
            />
          ) : null}
          {work}
          {versions.length > 0 ? (
            <WorkVersionStrip
              items={versionStrip(versions, currentVersionId)}
              history={history}
              viewedVersionId={viewed?.id ?? null}
              compared={compare === null ? null : new Set([compare.first, compare.second])}
              onView={(versionId) => {
                if (compare !== null) {
                  setCompare(pickCompareVersion(compare, versionId));
                  return;
                }
                viewVersion(versionId);
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
          {viewingOld && viewed !== null ? (
            <WorkBanner
              tone="info"
              icon="clock"
              title={`You are looking at V${viewed.ordinal}`}
              detail={history.restoreBlockedReason ?? "An earlier version, not the current one."}
            >
              <Button
                tone="text"
                size="compact"
                label="Back to current"
                onPress={() => viewVersion(null)}
              />
              <Button
                tone="secondary"
                size="compact"
                icon="arrow.uturn.backward"
                label={`Restore V${viewed.ordinal}`}
                disabled={history.restoreBlockedReason !== null}
                onPress={() => void moveHistory({ restore: viewed.id })}
              />
            </WorkBanner>
          ) : null}
          <SegmentedControl
            role="tab"
            options={[
              {
                value: "notes",
                label: notes.length === 0 ? "Notes & chat" : `Notes & chat · ${notes.length}`,
              },
              { value: "changes", label: "What changed" },
            ]}
            selected={panel}
            onSelect={setPanel}
          />
          {panel === "changes" ? (
            deliverable === null || viewed === null ? (
              <Text className="text-sm text-foreground-muted">No versions yet.</Text>
            ) : (
              <WorkWhatChanged
                environmentId={environmentId}
                kind={kind}
                version={viewed}
                parent={versions.find((version) => version.id === viewed.parentVersionId) ?? null}
                rendition={rendition}
                onUnit={focusAnchor}
                onCompare={() =>
                  setCompare(
                    viewed.parentVersionId === null
                      ? null
                      : { first: viewed.parentVersionId, second: viewed.id },
                  )
                }
              />
            )
          ) : (
            <View accessibilityLabel="Notes and chat" className="gap-3">
              <NotesSummary notes={notes} />
              {thread !== null && pendingRequests !== null ? (
                <PendingRequestCards
                  environmentId={environmentId}
                  threadId={thread.id}
                  requests={pendingRequests}
                  canOperate={canOperate}
                  onOpenChat={openChat}
                />
              ) : null}
              {spendApprovals.map((item) => (
                <SpendApprovalCard key={item.id} environmentId={environmentId} item={item} />
              ))}
              {unsent.length > 1 && canOperate ? (
                <Button
                  tone="secondary"
                  size="compact"
                  icon="arrow.up"
                  label={`Send ${unsent.length} open notes to the agent`}
                  disabled={sending}
                  onPress={() => void sendNotesNow(unsent)}
                />
              ) : null}
              {sorted.length === 0 && spendApprovals.length === 0 && thread === null ? (
                <View className="items-center gap-1 px-6 py-6">
                  <Text className="text-center text-base font-t3-medium">No notes yet</Text>
                  <Text className="text-center text-sm text-foreground-muted">
                    Type or talk below, or mark an area on the frame. A note pins to the moment or
                    slide you are on.
                  </Text>
                </View>
              ) : null}
              {sorted.map((note) => (
                <NoteCard
                  key={note.id}
                  environmentId={environmentId}
                  note={note}
                  kind={kind}
                  display={noteDisplay(note, (versionId) => ordinalById.get(versionId))}
                  rendition={rendition}
                  failure={failedNotes.includes(note) ? failure : null}
                  selected={note.id === highlighted}
                  canOperate={canOperate}
                  sending={sending}
                  onSend={() => void sendNotesNow([note])}
                  onCheck={onCheck}
                  onFocus={() => onFocusNote(note)}
                />
              ))}
              {thread === null ? null : (
                <WorkChatLog
                  environmentId={environmentId}
                  thread={thread}
                  noteMessageIds={noteMessageIds}
                  onOpenChat={openChat}
                />
              )}
            </View>
          )}
        </ScrollView>
        <WorkNoteComposer
          draftKey={`${environmentId}:${projectId}`}
          kind={kind}
          hasWork={deliverable !== null}
          disabled={!canOperate}
          pinLabel={pinLabel}
          pinned={pinned}
          onPinnedChange={setPinned}
          hasArea={region !== null}
          onClearArea={() => setRegion(null)}
          sending={sending}
          inputRef={inputRef}
          onSend={onSend}
        />
      </ScreenContent>
    </KeyboardAvoidingView>
  );
}
