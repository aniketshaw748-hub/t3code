import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  anchorFrameUrl,
  anchorRegion,
  noteAnchorChip,
  noteAuthorLabel,
} from "@t3tools/client-runtime/work/anchors";
import {
  checkLinkLabel,
  notesSummary,
  workChatEntries,
  type NoteCheckTarget,
  type NoteDisplay,
} from "@t3tools/client-runtime/work/notes";
import type { WorkRunFailure } from "@t3tools/client-runtime/work/shelf";
import type {
  DeliverableKind,
  DeliverableNote,
  DeliverableRendition,
  EnvironmentId,
} from "@t3tools/contracts";
import { agentPreviewText } from "@t3tools/shared/agentPreviewText";
import { describeAnchor } from "@t3tools/shared/deliverableNotes";
import * as DateTime from "effect/DateTime";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import { isThreadBusy, useThreadMessages, useWorkAssetUrl } from "./useWorkData";
import { AGENT_AUTHOR, AuthorLine, YOU_AUTHOR } from "./WorkAuthor";
import { renditionAspect } from "./WorkDeckStage";
import { WorkLink } from "./WorkLink";
import { MediaStage, RegionOutline } from "./WorkMediaStage";
import { NoteStatusLabel, noteStatusFillClassName } from "./WorkStatus";

/** Where the notes stand: each status in words, over a bar split by their counts. */
export function NotesSummary(props: { readonly notes: ReadonlyArray<DeliverableNote> }) {
  const summary = notesSummary(props.notes);
  if (summary.length === 0) return null;
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {summary.map((segment) => (
          <NoteStatusLabel key={segment.status} status={segment.status} label={segment.label} />
        ))}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="h-1 flex-row gap-0.5 overflow-hidden rounded-full"
      >
        {summary.map((segment) => (
          <View
            key={segment.status}
            className={noteStatusFillClassName(segment.status)}
            style={{ flexGrow: segment.count }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * A picture of where a note points, small. The server makes one for a note on a time, slide or
 * area: the frame with the area outlined and, for an area, a close-up under it, so it is shown
 * whole and nothing is drawn over it. A note without one gets the rendered slide or shot with
 * its area outlined here.
 */
function NoteFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly note: DeliverableNote;
  /** The rendition of the version on screen; a note on another version shows no frame from it. */
  readonly rendition: DeliverableRendition | null;
  readonly onPress: () => void;
}) {
  const { note } = props;
  const assetUrl = useWorkAssetUrl(props.environmentId);
  // A picture with a close-up is taller than its frame; its real shape is known once it loads.
  const [pictureAspect, setPictureAspect] = useState<number | null>(null);
  const picture = assetUrl(note.snapshotUrl);
  const region = anchorRegion(note.anchor);
  const frame =
    picture === null && region !== null && props.rendition?.versionId === note.versionId
      ? assetUrl(anchorFrameUrl(note.anchor, props.rendition))
      : null;
  const source = picture ?? frame;
  if (source === null) return null;
  const frameAspect = props.rendition === null ? 16 / 9 : renditionAspect(props.rendition, 16 / 9);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Show where this note points"
      onPress={props.onPress}
      className="self-start active:opacity-80"
    >
      <MediaStage
        className="rounded-md border border-border"
        style={{
          width: 160,
          aspectRatio: picture === null ? frameAspect : (pictureAspect ?? frameAspect),
        }}
      >
        <Image
          source={{ uri: source }}
          contentFit="contain"
          style={{ flex: 1 }}
          onLoad={({ source: loaded }) => {
            if (picture !== null && loaded.height > 0) {
              setPictureAspect(loaded.width / loaded.height);
            }
          }}
        />
        {frame === null || region === null ? null : <RegionOutline region={region} />}
      </MediaStage>
    </Pressable>
  );
}

/**
 * One note as a small thread with the agent: who wrote it and where it points, the note, its
 * status in words, the agent's short reply with a link to check the fix, and what can be done.
 */
export function NoteCard(props: {
  readonly environmentId: EnvironmentId;
  readonly note: DeliverableNote;
  readonly kind: DeliverableKind;
  readonly display: NoteDisplay;
  readonly rendition: DeliverableRendition | null;
  /** Set when the run working on this note stopped before fixing it. */
  readonly failure: WorkRunFailure | null;
  /** The note whose place is shown on the stage. */
  readonly selected: boolean;
  readonly canOperate: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly onCheck: (check: NoteCheckTarget) => void;
  readonly onFocus: () => void;
}) {
  const { note, display } = props;
  const setStatus = useAtomCommand(workEnvironment.setNoteStatus, "update note");
  const remove = useAtomCommand(workEnvironment.deleteNote, "delete note");
  const author = noteAuthorLabel(note.author);
  const check = display.check;
  const setTo = (status: "open" | "resolved") =>
    void setStatus({ environmentId: props.environmentId, input: { noteId: note.id, status } });
  const reply =
    note.reply === null
      ? display.status === "fixing"
        ? note.sentRunId === null
          ? "Sent. Waiting for the agent…"
          : "Working on it…"
        : null
      : agentPreviewText(note.reply);
  return (
    <View
      accessibilityLabel={`${author}: ${note.body}`}
      className={cn(
        "gap-2.5 rounded-[20px] border p-4",
        props.selected ? "border-primary bg-subtle" : "border-border bg-card-alt",
        note.status === "resolved" && "opacity-70",
      )}
    >
      <AuthorLine
        author={{ kind: "person", name: author }}
        meta={<RelativeTime timestamp={DateTime.formatIso(note.createdAt)} />}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Go to ${describeAnchor(note.anchor, props.kind)}`}
            onPress={props.onFocus}
            hitSlop={8}
            className="rounded-md border border-border px-1.5 py-0.5 active:opacity-70"
          >
            <Text className="font-mono text-2xs">{noteAnchorChip(note.anchor, props.kind)}</Text>
          </Pressable>
        }
      />
      <Text className="text-sm" selectable>
        {note.body}
      </Text>
      <NoteFrame
        environmentId={props.environmentId}
        note={note}
        rendition={props.rendition}
        onPress={props.onFocus}
      />
      <NoteStatusLabel status={display.status} label={display.label} />
      {props.failure === null ? null : (
        <View className="flex-row items-start gap-1.5">
          <View className="pt-0.5">
            <SymbolView
              name="exclamationmark.circle"
              size={13}
              tintColorClassName="accent-warning-foreground"
              type="monochrome"
            />
          </View>
          <Text className="shrink text-xs text-warning-foreground">
            <Text className="text-xs font-t3-medium text-warning-foreground">
              {props.failure.title}.
            </Text>{" "}
            The agent stopped before fixing this.
          </Text>
        </View>
      )}
      {reply === null ? null : (
        <View className="gap-1.5 rounded-xl bg-subtle p-3">
          <AuthorLine author={AGENT_AUTHOR} />
          <Text numberOfLines={3} className="text-xs text-foreground-muted">
            {reply}
          </Text>
          {check === null ? null : (
            <WorkLink label={checkLinkLabel(check)} onPress={() => props.onCheck(check)} />
          )}
        </View>
      )}
      {props.canOperate ? (
        <View className="flex-row flex-wrap items-center gap-1">
          {note.status === "open" ? (
            <Button
              tone="secondary"
              size="compact"
              icon={props.failure === null ? "arrow.up" : "arrow.clockwise"}
              label={
                props.failure !== null
                  ? "Retry"
                  : note.sentMessageId === null
                    ? "Send to agent"
                    : "Send again"
              }
              disabled={props.sending}
              onPress={props.onSend}
            />
          ) : null}
          {note.status === "fixed" ? (
            <>
              <Button
                tone="primary"
                size="compact"
                label="Looks good"
                onPress={() => setTo("resolved")}
              />
              <Button
                tone="text"
                size="compact"
                label="Still not right"
                onPress={() => setTo("open")}
              />
            </>
          ) : null}
          {note.status === "resolved" ? (
            <Button tone="text" size="compact" label="Reopen" onPress={() => setTo("open")} />
          ) : null}
          <View className="flex-1" />
          <IconButton
            icon="trash"
            tintColorClassName="accent-icon-muted"
            accessibilityLabel="Delete note"
            onPress={() =>
              void remove({ environmentId: props.environmentId, input: { noteId: note.id } })
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/** What was said outside notes, and each run's last reply, so a whole-deck ask reads as chat. */
export function WorkChatLog(props: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  /** Messages that sent notes: they show as their note cards instead. */
  readonly noteMessageIds: ReadonlySet<string>;
  readonly onOpenChat: () => void;
}) {
  const messages = useThreadMessages(scopeThreadRef(props.environmentId, props.thread.id));
  const entries = workChatEntries(messages, props.noteMessageIds);
  const working = isThreadBusy(props.thread);
  if (entries.length === 0 && !working) return null;
  return (
    <View accessibilityLabel="Chat" className="gap-3 px-1 pt-1">
      {entries.map((entry) => (
        <View key={entry.id} className="gap-1">
          <AuthorLine author={entry.role === "user" ? YOU_AUTHOR : AGENT_AUTHOR} />
          <Text
            numberOfLines={entry.role === "user" ? 3 : 4}
            className={cn(
              "pl-8 text-xs",
              entry.role === "user" ? "text-foreground" : "text-foreground-muted",
            )}
          >
            {entry.text}
          </Text>
        </View>
      ))}
      {working ? <AuthorLine author={AGENT_AUTHOR} meta="Working…" /> : null}
      <View className="pl-8">
        <WorkLink label="Open the full chat" onPress={props.onOpenChat} />
      </View>
    </View>
  );
}
