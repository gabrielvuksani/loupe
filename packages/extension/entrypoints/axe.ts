import axe from "axe-core";

// Unlisted script. Injected on demand (chrome.scripting) into the content
// script's isolated world, so the ~600KB axe-core runtime stays out of the
// per-page content bundle and only loads when a Standalone audit runs. The
// content script reads it off this shared isolated-world global after injection.
export default defineUnlistedScript(() => {
  (window as unknown as { __loupeAxe?: typeof axe }).__loupeAxe = axe;
});
