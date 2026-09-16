/**
 * Monaco installs its own touch handling straight on `document` (Gesture, see
 * node_modules/monaco-editor/esm/vs/base/browser/touch.js): as soon as a touch
 * starts inside the editor it consumes the gesture and calls preventDefault() +
 * stopPropagation(). The only consumers of those gesture events are caret and
 * selection helpers (editor/browser/controller/pointerHandler.js), never
 * scrolling, so on a phone the effect is that a swipe landing on an editor does
 * nothing at all -- not even scroll the page. Monaco's own scroller cannot take
 * over either: it hides its overflow and moves content with transforms.
 *
 * Stopping the touch at the editor wrapper, before it can reach Monaco's
 * document-level listener, gives every gesture back to the browser, so a swipe
 * that starts on an editor scrolls the page exactly like a swipe anywhere else.
 * Taps are unaffected: no preventDefault is called, so Chrome still emits the
 * mouse events Monaco uses to place the caret.
 */
const TOUCH_EVENT_TYPES = ["touchstart", "touchmove"];

export function attachEditorTouchGuard(wrapper) {
  if (!wrapper) return () => {};
  const guard = (event) => event.stopPropagation();
  for (const type of TOUCH_EVENT_TYPES) wrapper.addEventListener(type, guard, false);
  return () => {
    for (const type of TOUCH_EVENT_TYPES) wrapper.removeEventListener(type, guard, false);
  };
}
