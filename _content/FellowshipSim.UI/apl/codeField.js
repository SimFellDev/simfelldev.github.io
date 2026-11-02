// The CodeMirror editor of a CodeField. The editor's text is set here only: C# sends a new value with setValue, and each
// edit goes to C# as one Input call. C# sends the colours of each check with highlight, and completes the part at the caret.
import {
  Annotation,
  ChangeSet,
  Decoration,
  EditorState,
  EditorView,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  WidgetType,
  acceptCompletion,
  autocompletion,
  defaultKeymap,
  history,
  historyKeymap,
  keymap,
  placeholder,
  startCompletion,
} from "../lib/codemirror/codemirror.js";

// A change from C#, which C# does not need back as Input.
const fromComponent = Annotation.define();

const setColours = StateEffect.define();

// The token colours. Each edit moves them with the text: the text before and after the edit keeps its colours until the
// next check replaces them.
const colours = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setColours)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// A parse error at the end of the text: a marked space after it.
class ErrorAtEnd extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "tok-error";
    span.textContent = " ";
    return span;
  }
}

// The one change from `from` to `to`: the text between their common start and common end.
const changeBetween = (from, to) => {
  const most = Math.min(from.length, to.length);
  let start = 0;
  while (start < most && from[start] === to[start]) start++;
  let end = 0;
  while (end < most - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
};

// Opens the completion list when a name character or a '.' is before the caret.
const completeAtPart = (view) => {
  const { from, empty } = view.state.selection.main;
  if (!empty || from === 0 || !/[A-Za-z0-9_.]/.test(view.state.sliceDoc(from - 1, from))) return false;
  return startCompletion(view);
};

/**
 * Puts the editor of a CodeField in `field`. With `lines`, the text is a whole action list and Enter starts a new line;
 * otherwise Enter does nothing outside the completion list.
 */
export function attach(field, component, text, lines, placeholderText) {
  const complete = async (context) => {
    const reply = await component.invokeMethodAsync("Complete", context.state.doc.toString(), context.pos, context.explicit);
    if (!reply || context.aborted) return null;
    return {
      from: reply.from,
      to: reply.to,
      filter: false,
      options: reply.options.map((option) => ({
        label: option.label,
        detail: option.detail || undefined,
        className: option.class ?? "",
        apply: option.more
          ? (view, completion, from, to) => {
              view.dispatch({
                changes: { from, to, insert: option.written },
                selection: { anchor: from + option.written.length },
                userEvent: "input.complete",
              });
              startCompletion(view);
            }
          : option.written,
      })),
    };
  };

  const view = new EditorView({
    parent: field,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        colours,
        // A whole action list keeps each line on one row and scrolls sideways; one expression wraps.
        lines ? [] : EditorView.lineWrapping,
        autocompletion({ override: [complete], icons: false, optionClass: (completion) => completion.className }),
        // Tab writes the picked item of an open list, and opens the list on a part before the caret. With neither, it
        // moves the focus on.
        Prec.highest(keymap.of([{ key: "Tab", run: (view) => acceptCompletion(view) || completeAtPart(view) }])),
        lines ? [] : keymap.of([{ key: "Enter", run: () => true }]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        placeholder(placeholderText),
        EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((t) => t.annotation(fromComponent))) {
            component.invokeMethodAsync("Input", update.state.doc.toString());
          }
        }),
        EditorView.domEventHandlers({
          blur: () => {
            component.invokeMethodAsync("Blur");
          },
        }),
      ],
    }),
  });

  const markOf = new Map();
  const mark = (classes) => {
    let decoration = markOf.get(classes);
    if (!decoration) markOf.set(classes, (decoration = Decoration.mark({ class: classes })));
    return decoration;
  };

  return {
    /**
     * Writes the text as one change, so the caret and the colours outside it stay. Undo takes back the user's edits
     * alone: a text from C#, such as the builder's, is not in the history.
     */
    setValue(value) {
      const current = view.state.doc.toString();
      if (value === current) return;
      view.dispatch({
        changes: changeBetween(current, value),
        annotations: [fromComponent.of(true), Transaction.addToHistory.of(false)],
      });
    },
    /** The colours of a check (HighlightMarks, or null for none), moved to the text typed since it was made. */
    highlight(checked) {
      if (!checked) {
        view.dispatch({ effects: setColours.of(Decoration.none) });
        return;
      }
      const { text: checkedText, classes, marks, errorAtEnd } = checked;
      const ranges = [];
      for (let i = 0; i < marks.length; i += 3) ranges.push(mark(classes[marks[i + 2]]).range(marks[i], marks[i] + marks[i + 1]));
      if (errorAtEnd) ranges.push(Decoration.widget({ widget: new ErrorAtEnd(), side: 1 }).range(checkedText.length));
      let set = Decoration.set(ranges, true);
      const current = view.state.doc.toString();
      if (current !== checkedText) set = set.map(ChangeSet.of(changeBetween(checkedText, current), checkedText.length));
      view.dispatch({ effects: setColours.of(set) });
    },
    dispose() {
      view.destroy();
    },
  };
}
