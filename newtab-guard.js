// Runs before the page renders. If opened as a new tab (no ?from=action param)
// and the user hasn't enabled "use as new tab", redirect to Chrome's default.
(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.has('from')) return; // opened via icon click — always show

  chrome.storage.local.get('useAsNewTab', (result) => {
    if (!result.useAsNewTab) {
      // Redirect to Chrome's default new tab page
      window.location.replace('chrome-search://local-ntp/local-ntp.html');
    }
  });
})();
