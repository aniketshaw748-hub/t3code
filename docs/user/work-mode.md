# Work mode

Work mode is for making decks, videos and images with an agent. The work itself is the screen:
you review it, leave notes on it, and the agent fixes them as new versions. Code, diffs, terminals
and tool calls stay in Code mode.

## Starting

Switch **Code / Work** at the top of the sidebar. The app remembers the mode you picked. On the
shelf, **Make a deck**, **Cut a video** or **Image set** creates a Work project (a folder with its
own Git history) and starts the agent with a short brief. Each card shows the latest frame and one
status: drafting, rendering, waiting for you, notes back, in review, final, or the current version.

## Notes

Type in **Notes & chat** to leave a note on the moment the video is paused at or the slide you
selected; switch to **Whole video** or **Whole deck** to talk about all of it. Use the toolbar over
the player or slide to dictate a note or to draw on the frame; the drawing is attached to the note.

Each note shows where it stands: open, agent fixing, fixed in a version, or resolved. When the agent
fixes one, **Check it** opens that version at the right moment or slide. Choose **Looks good** to
resolve it, or **Still not right** to reopen it and send it again.

## Versions

Every change the agent saves is a version (V1, V2, ...). The strip under the work shows them with a
one-line summary. Undo, redo and **Restore** move the files back and forth; they wait until the
agent's turn ends. Editing after an undo starts a new branch, and the old versions stay restorable.
**Compare** shows two versions side by side or overlaid, with the changed slides or shots marked.

Before a paid generation step, the agent shows what it will make and what it costs. Nothing is
spent until you choose **Approve**.
