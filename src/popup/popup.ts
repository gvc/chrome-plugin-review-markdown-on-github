const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;

chrome.storage.sync.get('enabled', (data) => {
  enabledCheckbox.checked = data.enabled !== false;
});

enabledCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledCheckbox.checked });
});
