import { useAtom } from "@effect/atom-react";
import type { DeliverableKind } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useState, type Ref } from "react";
import { Pressable, View, type TextInputInstance } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ComposerEditorSelection } from "../../components/ComposerEditor";
import {
  ComposerActionButton,
  ComposerInlineControl,
  ComposerToolbarRow,
} from "../../components/ComposerToolbar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
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

/**
 * Where notes and messages to the agent are written. It is the chat composer's card, toolbar
 * controls and send button around a plain text field, with one choice the chat does not have:
 * whether the words pin to a place in the work or are about all of it.
 */
export function WorkNoteComposer({
  inputRef,
  ...props
}: {
  readonly draftKey: string;
  readonly kind: DeliverableKind;
  readonly hasWork: boolean;
  readonly disabled: boolean;
  /** `0:42` or `Slide 3`; null when a note can only be about the whole file. */
  readonly pinLabel: string | null;
  readonly pinned: boolean;
  readonly onPinnedChange: (pinned: boolean) => void;
  /** An area is marked on the frame for this note; a marked area always pins. */
  readonly hasArea: boolean;
  readonly onClearArea: () => void;
  readonly sending: boolean;
  readonly inputRef?: Ref<TextInputInstance>;
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
  const pinned = props.pinLabel !== null && (props.pinned || props.hasArea);
  const canSend =
    !props.disabled && !props.sending && text.trim().length > 0 && !voice.blocksSubmission;
  const send = async () => {
    if (!canSend) return;
    if (await props.onSend(text.trim())) setText("");
  };
  return (
    <View
      className="px-3 pt-1"
      style={{ paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12) }}
    >
      <View className="overflow-hidden rounded-[22px] border border-composer-border border-continuous bg-composer-surface">
        {props.hasArea ? (
          <View className="flex-row items-center gap-1 px-3 pt-2.5">
            <View className="h-7 flex-row items-center gap-1.5 rounded-full bg-subtle pl-2.5 pr-1">
              <SymbolView
                name="pencil"
                size={13}
                tintColorClassName="accent-icon"
                type="monochrome"
              />
              <Text className="text-xs font-t3-medium">Area marked</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove the marked area"
                onPress={props.onClearArea}
                hitSlop={10}
                className="size-6 items-center justify-center active:opacity-60"
              >
                <SymbolView
                  name="xmark"
                  size={11}
                  tintColorClassName="accent-icon-muted"
                  type="monochrome"
                  weight="semibold"
                />
              </Pressable>
            </View>
          </View>
        ) : null}
        <AppTextInput
          ref={inputRef}
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
                ? `Leave a note at ${props.pinLabel}`
                : `Ask for a change to the whole ${noun}`
          }
          className="max-h-32 min-h-11 rounded-none border-0 bg-transparent px-4 pt-3 pb-1"
        />
        <ComposerDictationError
          error={voice.state.phase === "error" ? voice.state.error : null}
          onDismiss={voice.cancel}
        />
        {dictating ? (
          <ComposerDictationToolbar showsDictation>
            <ComposerToolbarRow paddingTop={0} paddingBottom={0} style={{ gap: 0 }}>
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
            </ComposerToolbarRow>
          </ComposerDictationToolbar>
        ) : (
          <ComposerToolbarRow paddingTop={0} paddingBottom={4} style={{ gap: 0 }}>
            {props.hasWork ? (
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="What the note is about"
                className="min-w-0 shrink flex-row items-center"
              >
                <ComposerInlineControl
                  icon="pin"
                  label={props.pinLabel === null ? "Pin here" : `At ${props.pinLabel}`}
                  accessibilityHint={
                    props.pinLabel === null
                      ? "Pick a slide or mark an area to pin a note"
                      : "A note pinned to this place, tracked until it is fixed"
                  }
                  selected={pinned}
                  disabled={props.pinLabel === null}
                  showChevron={false}
                  onPress={() => props.onPinnedChange(true)}
                />
                <ComposerInlineControl
                  icon="doc"
                  label={`Whole ${noun}`}
                  accessibilityHint={`A message about the whole ${noun}, not pinned anywhere`}
                  selected={!pinned}
                  disabled={props.hasArea}
                  showChevron={false}
                  onPress={() => props.onPinnedChange(false)}
                />
              </View>
            ) : null}
            <View className="flex-1" />
            {voice.isAvailable ? (
              <ComposerDictationStartAction
                state={voice.state}
                isAvailable={voice.isAvailable}
                disabled={props.disabled}
                onStart={voice.start}
                onCancel={voice.cancel}
              />
            ) : null}
            <ComposerActionButton
              variant="primary"
              icon="arrow.up"
              accessibilityLabel={pinned || !props.hasWork ? "Send note" : "Send message"}
              disabled={!canSend}
              onPress={() => void send()}
            />
          </ComposerToolbarRow>
        )}
      </View>
    </View>
  );
}
