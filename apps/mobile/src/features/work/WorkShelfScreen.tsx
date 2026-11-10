import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { posterFor, primaryDeliverable, shelfStatus } from "@t3tools/client-runtime/work/shelf";
import { WORK_STARTERS, type WorkStarter } from "@t3tools/client-runtime/work/starters";
import type { DeliverableKind, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironments } from "../../state/environments";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { useStartWorkProject } from "./useWorkActions";
import {
  isThreadBusy,
  useLatestAgentText,
  useWorkAssetUrl,
  useWorkProjects,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { MEDIA_STAGE, MediaStage } from "./WorkMediaStage";
import { ShelfStatusLabel } from "./WorkStatus";

const WORK_KIND_ICON: Record<DeliverableKind, AppSymbolName> = {
  deck: "square.grid.2x2",
  video: "play",
  image: "photo",
  pdf: "doc.text",
  other: "sparkles",
};

// The page keeps to a readable width on a tablet, like the other workspace pages.
const MAX_CONTENT_WIDTH = 1080;
const CARD_GAP = 16;
// Two cards across on a phone; a wider page fits as many of about this width as it has room for.
const CARD_WIDTH = 220;

/** Work mode's home: a card per project with its latest frame, its status in words and its version. */
export function WorkShelfScreen() {
  const projects = useWorkProjects();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const environmentId =
    environments.find((environment) => environment.connection.phase === "available")
      ?.environmentId ?? null;
  const start = useStartWorkProject();
  const [starting, setStarting] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const columns = Math.max(2, Math.floor((gridWidth + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
  // Every card is one column wide, so a last card on its own does not stretch across the page.
  const cardWidth = gridWidth > 0 ? (gridWidth - CARD_GAP * (columns - 1)) / columns : "47%";
  const open = (target: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    navigation.dispatch(StackActions.push("WorkProject", target));
  const onStart = async (starter: WorkStarter) => {
    if (environmentId === null || starting !== null) return;
    setStarting(starter.id);
    const projectId = await start(environmentId, starter);
    setStarting(null);
    if (projectId !== null) open({ environmentId, projectId });
  };
  const starters = WORK_STARTERS.map((starter) => (
    <Chip
      key={starter.id}
      icon={WORK_KIND_ICON[starter.kind]}
      label={starting === starter.id ? "Starting…" : starter.label}
      disabled={environmentId === null || starting !== null}
      onPress={() => void onStart(starter)}
    />
  ));
  return (
    <SettingsScreen
      workspaceRoot
      title="Work"
      subtitle={projects.length === 1 ? "1 project" : `${projects.length} projects`}
    >
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {projects.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No Work projects yet"
            detail="Start a deck, a video or an image set. The agent drafts it, and you review it here with notes pinned to the moment or slide."
            action={<View className="flex-row flex-wrap justify-center gap-2">{starters}</View>}
          />
        ) : (
          <View className="w-full gap-6 self-center" style={{ maxWidth: MAX_CONTENT_WIDTH }}>
            <View accessibilityLabel="Start a project" className="flex-row flex-wrap gap-2">
              {starters}
            </View>
            <View
              onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)}
              className="flex-row flex-wrap gap-y-6"
              style={{ columnGap: CARD_GAP }}
            >
              {projects.map((project) => (
                <WorkProjectCard
                  key={`${project.environmentId}:${project.id}`}
                  project={project}
                  width={cardWidth}
                  onPress={() =>
                    open({ environmentId: project.environmentId, projectId: project.id })
                  }
                />
              ))}
            </View>
          </View>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

function WorkProjectCard(props: {
  readonly project: EnvironmentProject;
  readonly width: number | `${number}%`;
  readonly onPress: () => void;
}) {
  const { project } = props;
  const snapshot = useWorkProjectSnapshot(project.environmentId, project.id);
  const threads = useWorkThreads(project.environmentId, project.id);
  const assetUrl = useWorkAssetUrl(project.environmentId);
  const running = threads.find((thread) => isThreadBusy(thread)) ?? null;
  // Only a running agent's words are read, so idle cards open no thread subscription.
  const agentText = useLatestAgentText(
    running === null ? null : scopeThreadRef(running.environmentId, running.id),
  );
  const status = shelfStatus({
    snapshot,
    threads: threads.map((thread) => thread.source),
    agentText,
  });
  const deliverable = snapshot === null ? null : primaryDeliverable(snapshot.deliverables);
  const poster =
    snapshot === null || deliverable === null
      ? null
      : assetUrl(posterFor(snapshot, deliverable.currentVersionId));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[project.title, status.label, status.version]
        .filter((part) => part !== null)
        .join(", ")}
      onPress={props.onPress}
      className="gap-2 active:opacity-80"
      style={{ width: props.width }}
    >
      <MediaStage className="aspect-video items-center justify-center border border-border">
        {poster === null ? (
          <SymbolView
            name={WORK_KIND_ICON[deliverable?.kind ?? "other"]}
            size={28}
            tintColor={MEDIA_STAGE.muted}
          />
        ) : (
          <Image
            source={{ uri: poster }}
            contentFit="cover"
            recyclingKey={poster}
            style={{ width: "100%", height: "100%" }}
            accessibilityIgnoresInvertColors
          />
        )}
      </MediaStage>
      <View className="gap-0.5 px-0.5">
        <View className="flex-row items-baseline gap-2">
          <Text numberOfLines={1} className="shrink text-base font-t3-medium">
            {project.title}
          </Text>
          <View className="flex-1" />
          {status.version === null ? null : (
            <Text className="font-mono text-2xs text-foreground-muted">{status.version}</Text>
          )}
        </View>
        <ShelfStatusLabel kind={status.kind} label={status.label} lines={2} />
      </View>
    </Pressable>
  );
}
