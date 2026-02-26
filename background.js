// When the extension icon is clicked, open the habit tracker in a new tab
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('habit.html?from=action') });
});
