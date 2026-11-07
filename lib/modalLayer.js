/**
 * Shared modal layer registry.
 *
 * Every overlay in the app that is a true modal — ResidentModal (and the
 * confirm dialogs stacked on it), DocumentViewerModal, and the Reklamo
 * document preview — registers here for the duration it is open. Two things
 * are coordinated centrally because per-component bookkeeping gets them
 * wrong as soon as any two overlays overlap:
 *
 *  - The body scroll lock. Only the first layer to open locks the page and
 *    only the last to close releases it. Previously ResidentModal kept its
 *    own counter while DocumentViewerModal saved/restored `overflow`, so a
 *    dialog closing underneath the viewer could unlock the body and let the
 *    page scroll behind a modal that was still onscreen.
 *  - Escape handling. Each layer asks whether it is topmost before acting,
 *    so one Escape dismisses one overlay rather than all of them at once.
 *
 * The registry holds layer tokens (plain objects) in open order; the last
 * pushed is the topmost. It is intentionally module state, not React state:
 * it is shared across independent component trees and must not trigger
 * re-renders.
 */

const layers = [];

export function pushModalLayer(token) {
  layers.push(token);
  if (layers.length === 1) {
    document.body.style.overflow = "hidden";
  }
}

export function popModalLayer(token) {
  const index = layers.lastIndexOf(token);
  if (index !== -1) layers.splice(index, 1);
  if (layers.length === 0) {
    document.body.style.overflow = "";
  }
}

export function isTopModalLayer(token) {
  return layers[layers.length - 1] === token;
}

export function hasModalLayer() {
  return layers.length > 0;
}
