import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { notePinAnchor, notePinLabel, renditionMeta } from "@t3tools/client-runtime/work/anchors";
import {
  defaultCompareSelection,
  orderedCompare,
  pickCompareVersion,
  type CompareSelection,
} from "@t3tools/client-runtime/work/compare";
import { noteDisplay, sortNotes, type NoteCheckTarget } from "@t3tools/client-runtime/work/notes";
import { primaryDeliverable } from "@t3tools/client-runtime/work/shelf";
import { historyAvailability, versionStrip } from "@t3tools/client-runtime/work/versions";
import {
  AuthOrchestrationOperateScope,
  type DeliverableAnchor,
  type DeliverableId,
  type DeliverableNote,
  type DeliverableNoteId,
  type DeliverableVersionId,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import * as Dialog from "../../components/ui/Dialog";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
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
  useWorkAssetUrl,
  useWorkPendingRequests,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { WorkCompareView } from "./WorkCompareView";
import { WorkDeckStage } from "./WorkDeckStage";
import { WorkNoteComposer } from "./WorkNoteComposer";
import {
  AgentLine,
  NoteCard,
  NotesSummary,
  PendingRequestsCard,
  SpendApprovalCard,
} from "./WorkNotes";
import { WorkVersionStrip } from "./WorkVersionStrip";
import { WorkVideoStage, type SeekRequest } from "./WorkVideoStage";

export type WorkProjectParams = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
};

export function WorkProjectRouteScreen({ route }: StaticScreenProps<WorkProjectParams>) {
  return (
    <WorkProjectScreen
      key={`${route.params.environmentId}:${route.params.projectId}`}
      environmentId={route.params.environmentId}
      projectId={route.params.projectId}
    />
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
  const [pinned, setPinned] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);

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
  const workingSlide =
    progress.step !== null && /^(Slide|Page) /.test(progress.step)
      ? Number(progress.step.split(" ")[1]) - 1
      : null;
  const pinTarget = { kind, playheadSeconds: playhead, selectedSlide, region: null };
  const pinLabel = notePinLabel(pinTarget);
  const ordinalById = new Map(versions.map((version) => [version.id, version.ordinal]));
  const sorted = sortNotes(notes);
  const unsent = notes.filter((note) => note.status === "open" && note.sentMessageId === null);

  const openChat = () => {
    if (thread !== null) {
      navigation.dispatch(StackActions.push("Thread", { environmentId, threadId: thread.id }));
    }
  };

  const focusAnchor = (anchor: DeliverableAnchor | null) => {
    if (anchor === null) return;
    if (anchor.kind === "time") setSeek({ seconds: anchor.t, nonce: (seek?.nonce ?? 0) + 1 });
    if (anchor.kind === "slide") setSelectedSlide(anchor.index);
  };

  const onCheck = (check: NoteCheckTarget) => {
    setCompare(null);
    setViewedVersionId(check.versionId === currentVersionId ? null : check.versionId);
    focusAnchor(check.anchor);
  };

  const onFocusNote = (note: DeliverableNote) => {
    setHighlighted(note.id);
    setCompare(null);
    if (note.versionId !== viewed?.id && note.status !== "fixed") {
      setViewedVersionId(note.versionId === currentVersionId ? null : note.versionId);
    }
    focusAnchor(note.anchor);
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

  const onSend = async (body: string): Promise<boolean> => {
    if (sending) return false;
    if (deliverable === null || viewed === null) {
      // Nothing to pin a note to yet: this is a plain message to the agent.
      setSending(true);
      const sent = await sendMessage({ environmentId, projectId, thread, text: body });
      setSending(false);
      return sent !== null;
    }
    setSending(true);
    const created = await createNote({
      environmentId,
      input: {
        deliverableId: deliverable.id,
        versionId: viewed.id,
        anchor: notePinAnchor(pinTarget, pinned),
        body,
      },
    });
    setSending(false);
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        const error = squashAtomCommandFailure(created);
        Dialog.alert("Could not save the note", error instanceof Error ? error.message : undefined);
      }
      return false;
    }
    await sendNotesNow([created.value]);
    return true;
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
      : [`V${viewed.ordinal}${viewed.id === currentVersionId ? " · current" : ""}`, meta]
          .filter((part) => part !== null)
          .join(" · ");

  const message = (text: string) => (
    <View className="mx-4 items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12">
      <Text className="text-center text-sm text-foreground-muted">{text}</Text>
    </View>
  );

  // The video stays above the scrolling notes so a seek from a note is always in view.
  const pinnedStage =
    comparePair === null && kind === "video" && rendition !== null && viewed !== null ? (
      <WorkVideoStage
        sourceUrl={assetUrl(rendition.proxyUrl ?? rendition.sourceUrl)}
        aspect={
          rendition.width !== null && rendition.height !== null && rendition.height > 0
            ? rendition.width / rendition.height
            : 16 / 9
        }
        durationSeconds={rendition.durationSeconds}
        notes={notes}
        seek={seek}
        onTime={setPlayhead}
        onMarker={(marker) => setHighlighted(marker.noteIds[0] ?? null)}
      />
    ) : null;

  const stage = (() => {
    if (snapshot === null) return message("Loading…");
    if (deliverable === null || viewed === null) {
      return message(
        busy
          ? `The agent is drafting${progress.step === null ? "" : ` · ${progress.step.toLowerCase()}`}. The first version appears here when it saves one.`
          : "Nothing here yet. Tell the agent what to make below.",
      );
    }
    if (comparePair !== null) {
      return (
        <View className="px-4">
          <WorkCompareView
            environmentId={environmentId}
            kind={kind}
            base={comparePair.base}
            target={comparePair.target}
            assetUrl={assetUrl}
          />
        </View>
      );
    }
    if (kind === "video") return rendition === null ? message(`Loading V${viewed.ordinal}…`) : null;
    if (rendition === null) return message(`Loading V${viewed.ordinal}…`);
    if (rendition.status !== "ready") {
      return message(
        rendition.status === "pending" || rendition.status === "rendering"
          ? `Rendering V${viewed.ordinal}…`
          : (rendition.detail ?? `V${viewed.ordinal} could not be rendered.`),
      );
    }
    if (kind === "deck" || kind === "pdf") {
      return (
        <View className="px-4">
          <WorkDeckStage
            rendition={rendition}
            notes={notes}
            noun={kind === "pdf" ? "Page" : "Slide"}
            selectedSlide={selectedSlide}
            workingSlide={workingSlide}
            assetUrl={assetUrl}
            onSelectSlide={setSelectedSlide}
          />
        </View>
      );
    }
    const still = assetUrl(rendition.units[0]?.imageUrl ?? rendition.posterUrl);
    return still === null ? null : (
      <View
        className="mx-4 overflow-hidden rounded-xl"
        style={{ aspectRatio: 4 / 3, backgroundColor: "#0b0b0b" }}
      >
        <Image source={{ uri: still }} contentFit="contain" style={{ flex: 1 }} />
      </View>
    );
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
      {pinnedStage}
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerClassName="gap-4 pt-3 pb-6"
      >
        {deliverables.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-1.5 px-4"
          >
            {deliverables.map((candidate) => {
              const selected = candidate.id === deliverable?.id;
              return (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setChosenDeliverable(candidate.id);
                    setViewedVersionId(null);
                    setCompare(null);
                    setSelectedSlide(null);
                  }}
                  className={cn(
                    "h-8 justify-center rounded-full px-3",
                    selected ? "bg-foreground" : "bg-subtle",
                  )}
                >
                  <Text
                    className={cn(
                      "text-xs font-t3-medium",
                      selected ? "text-screen" : "text-foreground",
                    )}
                  >
                    {candidate.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {stage}
        {versions.length > 0 ? (
          <View className="gap-2 px-4">
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
            {viewed?.summary && comparePair === null ? (
              <Pressable
                accessibilityRole="button"
                disabled={viewed.summaryDetail === undefined}
                onPress={() => setSummaryOpen((open) => !open)}
              >
                <Text className="text-xs text-foreground-muted">
                  V{viewed.ordinal}:{" "}
                  {summaryOpen && viewed.summaryDetail !== undefined
                    ? viewed.summaryDetail
                    : viewed.summary}
                </Text>
              </Pressable>
            ) : null}
            {viewingOld && viewed !== null ? (
              <View className="flex-row flex-wrap items-center gap-2 rounded-xl bg-subtle px-3 py-2">
                <Text className="flex-1 text-xs">You are looking at V{viewed.ordinal}.</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setViewedVersionId(null)}
                  hitSlop={6}
                >
                  <Text className="text-xs font-t3-medium underline">Back to current</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: history.restoreBlockedReason !== null }}
                  accessibilityHint={history.restoreBlockedReason ?? undefined}
                  disabled={history.restoreBlockedReason !== null}
                  onPress={() => void moveHistory({ restore: viewed.id })}
                  hitSlop={6}
                  className={history.restoreBlockedReason === null ? undefined : "opacity-40"}
                >
                  <Text className="text-xs font-t3-medium underline">
                    Restore V{viewed.ordinal}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
        <View accessibilityLabel="Notes and chat" className="gap-3 px-4">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            {notes.length === 0 ? "Notes & chat" : `Notes & chat · ${notes.length}`}
          </Text>
          <NotesSummary notes={notes} />
          {spendApprovals.map((item) => (
            <SpendApprovalCard key={item.id} environmentId={environmentId} item={item} />
          ))}
          {thread !== null && pendingRequests !== null ? (
            <PendingRequestsCard
              environmentId={environmentId}
              threadId={thread.id}
              requests={pendingRequests}
              canOperate={canOperate}
              onOpenChat={openChat}
            />
          ) : null}
          {unsent.length > 1 && canOperate ? (
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => void sendNotesNow(unsent)}
              className="self-start rounded-full border border-border px-3.5 py-2 active:opacity-70"
            >
              <Text className="text-xs font-t3-medium">
                Send {unsent.length} open notes to the agent
              </Text>
            </Pressable>
          ) : null}
          {sorted.length === 0 && spendApprovals.length === 0 && thread === null ? (
            <Text className="py-4 text-center text-sm text-foreground-muted">
              Leave a note: type or talk below. It pins to the moment or slide you are on.
            </Text>
          ) : null}
          {sorted.map((note) => (
            <NoteCard
              key={note.id}
              environmentId={environmentId}
              note={note}
              kind={kind}
              display={noteDisplay(note, (versionId) => ordinalById.get(versionId))}
              highlighted={note.id === highlighted}
              canOperate={canOperate}
              sending={sending}
              onSend={() => void sendNotesNow([note])}
              onCheck={onCheck}
              onFocus={() => onFocusNote(note)}
            />
          ))}
          {thread === null ? null : (
            <AgentLine environmentId={environmentId} thread={thread} onOpenChat={openChat} />
          )}
        </View>
      </ScrollView>
      <WorkNoteComposer
        draftKey={`${environmentId}:${projectId}`}
        kind={kind}
        hasWork={deliverable !== null}
        disabled={!canOperate}
        pinLabel={pinLabel}
        pinned={pinned}
        onPinnedChange={setPinned}
        sending={sending}
        onSend={onSend}
      />
    </KeyboardAvoidingView>
  );
}
