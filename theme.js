// Runs before first paint (loaded in <head>) so a saved dark theme never flashes light.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('cb-theme'); } catch (e) { /* storage blocked: fall back to system */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
