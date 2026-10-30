// Browser work of the condition reference that C# cannot do: showing its dialog as a modal. The dialog closes on Escape,
// on its Close button (a method="dialog" form) and on a click on its backdrop.

const bound = new WeakSet();

/** Shows `dialog` as a modal, scrolled to its top. */
export function open(dialog) {
  if (!bound.has(dialog)) {
    bound.add(dialog);
    // A click on the backdrop targets the dialog itself; a click inside it targets its content.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  dialog.showModal();
  dialog.querySelector(".body")?.scrollTo(0, 0);
}
