import { useAtom } from "@effect/atom-react";
import type { DeliverableKind } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  ComposerDictationCancelAction,
  ComposerDictationError,
  ComposerDictationPrimaryAction,
  ComposerDictationStartAction,
  ComposerDictationStatus,
  ComposerDictationToolbar,
} from "../voice-input/ComposerDictationControl";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { resolveVoiceComposerPresentation } from "../voice-input/voiceInputPresentation";

// Per project, so a half-written note survives leaving the screen and dictation can follow it.
const noteDraftAtom = Atom.family((key: string) =>
  Atom.make("").pipe(Atom.keepAlive, Atom.withLabel(`mobile:work-note-draft:${key}`)),
);

const NOUN: Record<DeliverableKind, string> = {
  deck: "deck",
  video: "video",
  image: "file",
  pdf: "file",
  other: "file",
};

/** Type or talk a note; it pins to the playhead or picked slide unless set to the whole file. */
export function WorkNoteComposer(props: {
  readonly draftKey: string;
  readonly kind: DeliverableKind;
  readonly hasWork: boolean;
  readonly disabled: boolean;
  /** `0:42` or `Slide 3`; null when a note can only be about the whole file. */
  readonly pinLabel: string | null;
  readonly pinned: boolean;
  readonly onPinnedChange: (pinned: boolean) => void;
  readonly sending: boolean;
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const atom = noteDraftAtom(props.draftKey);
  const [text, setText] = useAtom(atom);
  const [selection, setSelection] = useState<ComposerEditorSelection>({ start: 0, end: 0 });
  const voice = useVoiceInputController({
    ownerKey: `work-note:${props.draftKey}`,
    label: "Work note",
    readDraftMessage: () => appAtomRegistry.get(atom),
    subscribeToDraftChanges: (onChange) => appAtomRegistry.subscribe(atom, onChange),
    selection,
    disabled: props.disabled,
    onChangeDraftMessage: setText,
    onChangeSelection: setSelection,
  });
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const presentation = resolveVoiceComposerPresentation(voice.state, voice.elapsedSeconds);
  const dictating = presentation.statusKind === "active";
  const noun = NOUN[props.kind];
  const pinned = props.pinned && props.pinLabel !== null;
  const canSend =
    !props.disabled && !props.sending && text.trim().length > 0 && !voice.blocksSubmission;
  const send = async () => {
    if (!canSend) return;
    if (await props.onSend(text.trim())) setText("");
  };
  return (
    <View
      className="gap-2 border-t border-border bg-screen px-3 pt-2.5"
      style={{ paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12) }}
    >
      {props.hasWork ? (
        <View className="flex-row gap-1.5" accessibilityLabel="What the note is about">
          <PinChip
            label={props.pinLabel === null ? "Here" : `At ${props.pinLabel}`}
            selected={pinned}
            disabled={props.pinLabel === null}
            onPress={() => props.onPinnedChange(true)}
          />
          <PinChip
            label={`Whole ${noun}`}
            selected={!pinned}
            onPress={() => props.onPinnedChange(false)}
          />
        </View>
      ) : null}
      <View className="flex-row items-end gap-2">
        <TextInput
          accessibilityLabel="Note for the agent"
          value={text}
          onChangeText={setText}
          selection={selection}
          onSelectionChange={({ nativeEvent }) => setSelection(nativeEvent.selection)}
          readOnly={props.disabled || voice.freezesEditor}
          multiline
          textAlignVertical="top"
          placeholder={
            !props.hasWork
              ? "Tell the agent what to make"
              : pinned
                ? `Note at ${props.pinLabel}`
                : `Ask for a change to the whole ${noun}`
          }
          placeholderTextColorClassName="accent-foreground-muted"
          className="max-h-32 min-h-11 min-w-0 flex-1 rounded-2xl border border-input-border bg-input px-3.5 py-2.5 font-sans text-base text-foreground"
        />
        {voice.isAvailable && !dictating ? (
          <ComposerDictationStartAction
            state={voice.state}
            isAvailable={voice.isAvailable}
            disabled={props.disabled}
            onStart={voice.start}
            onCancel={voice.cancel}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send note"
          accessibilityState={{ disabled: !canSend, busy: props.sending }}
          disabled={!canSend}
          onPress={() => void send()}
          className={cn(
            "size-11 items-center justify-center rounded-full bg-foreground",
            canSend ? "active:opacity-70" : "opacity-30",
          )}
        >
          <SymbolView name="arrow.up" size={18} tintColorClassName="accent-screen" />
        </Pressable>
      </View>
      <ComposerDictationError
        error={voice.state.phase === "error" ? voice.state.error : null}
        onDismiss={voice.cancel}
      />
      {dictating ? (
        <ComposerDictationToolbar showsDictation>
          <View className="h-11 flex-row items-center">
            <ComposerDictationCancelAction presentation={presentation} onCancel={voice.cancel} />
            <ComposerDictationStatus
              audioLevels={voice.audioLevels}
              elapsedSeconds={voice.elapsedSeconds}
              phase={voice.state.phase}
              presentation={presentation}
            />
            <ComposerDictationPrimaryAction
              state={voice.state}
              presentation={presentation}
              isAvailable={voice.isAvailable}
              disabled={props.disabled}
              onStart={voice.start}
              onConfirm={voice.stop}
              onCancel={voice.cancel}
            />
          </View>
        </ComposerDictationToolbar>
      ) : null}
    </View>
  );
}

function PinChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected, disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "h-7 justify-center rounded-full px-3",
        props.selected ? "bg-foreground" : "bg-subtle",
        props.disabled && "opacity-40",
      )}
    >
      <Text
        className={cn(
          "font-mono text-2xs font-t3-medium",
          props.selected ? "text-screen" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
