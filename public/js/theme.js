// Loaded synchronously in <head> so the page paints in the right theme.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('beacon-theme') || 'system'; } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-theme-pref', pref);
})();
