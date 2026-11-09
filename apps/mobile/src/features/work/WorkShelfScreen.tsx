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

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironments } from "../../state/environments";
import { useStartWorkProject } from "./useWorkActions";
import {
  isThreadBusy,
  useLatestAgentText,
  useWorkAssetUrl,
  useWorkProjects,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { ShelfStatusChip } from "./WorkStatus";

export const WORK_KIND_ICON: Record<DeliverableKind, AppSymbolName> = {
  deck: "square.grid.2x2",
  video: "play",
  image: "photo",
  pdf: "doc.text",
  other: "sparkles",
};

/** Work mode's home: a card per project with its latest frame and one plain status. */
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
  const open = (target: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    navigation.dispatch(StackActions.push("WorkProject", target));
  const onStart = async (starter: WorkStarter) => {
    if (environmentId === null || starting !== null) return;
    setStarting(starter.id);
    const projectId = await start(environmentId, starter);
    setStarting(null);
    if (projectId !== null) open({ environmentId, projectId });
  };
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Work"
        subtitle={projects.length === 1 ? "1 project" : `${projects.length} projects`}
      />
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 20 }}
      >
        <View accessibilityLabel="Start a project" className="flex-row flex-wrap gap-2">
          {WORK_STARTERS.map((starter) => (
            <Pressable
              key={starter.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: environmentId === null || starting !== null }}
              disabled={environmentId === null || starting !== null}
              onPress={() => void onStart(starter)}
              className="h-9 flex-row items-center gap-2 rounded-full border border-border bg-card px-3.5 active:opacity-70"
            >
              <SymbolView
                name={WORK_KIND_ICON[starter.kind]}
                size={16}
                tintColorClassName="accent-icon-muted"
              />
              <Text className="text-sm font-t3-medium">
                {starting === starter.id ? "Starting…" : starter.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {projects.length === 0 ? (
          <View className="items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14">
            <Text className="text-base font-t3-medium">No Work projects yet</Text>
            <Text className="text-center text-sm text-foreground-muted">
              Start a deck, a video or an image set above. The agent drafts it, and you review it
              here with notes pinned to the moment or slide.
            </Text>
          </View>
        ) : (
          <View className="flex-row flex-wrap gap-4">
            {projects.map((project) => (
              <WorkProjectCard
                key={`${project.environmentId}:${project.id}`}
                project={project}
                onPress={() =>
                  open({ environmentId: project.environmentId, projectId: project.id })
                }
              />
            ))}
          </View>
        )}
      </ScreenScrollView>
    </View>
  );
}

function WorkProjectCard(props: {
  readonly project: EnvironmentProject;
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
      accessibilityLabel={`${project.title}, ${status.label}`}
      onPress={props.onPress}
      className="min-w-[150px] flex-1 basis-[42%] gap-2 active:opacity-80"
    >
      <View className="aspect-video items-center justify-center overflow-hidden rounded-xl border border-border bg-[#0b0b0b]">
        {poster === null ? (
          <SymbolView
            name={WORK_KIND_ICON[deliverable?.kind ?? "other"]}
            size={28}
            tintColor="#8a8a8a"
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
      </View>
      <Text numberOfLines={1} className="text-sm font-t3-medium">
        {project.title}
      </Text>
      <ShelfStatusChip kind={status.kind} label={status.label} />
    </Pressable>
  );
}
