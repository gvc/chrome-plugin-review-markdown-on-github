const enabledCheckbox = document.getElementById('enabled') as HTMLInputElement;
const patInput = document.getElementById('pat') as HTMLInputElement;
const savePatBtn = document.getElementById('save-pat') as HTMLButtonElement;
const patStatus = document.getElementById('pat-status') as HTMLSpanElement;

chrome.storage.sync.get(['enabled', 'pat'], (data) => {
  enabledCheckbox.checked = data.enabled !== false;
  if (data.pat) {
    patInput.value = data.pat;
  }
});

enabledCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledCheckbox.checked });
});

savePatBtn.addEventListener('click', () => {
  const pat = patInput.value.trim();
  chrome.storage.sync.set({ pat }, () => {
    patStatus.textContent = pat ? 'Saved' : 'Cleared';
    setTimeout(() => { patStatus.textContent = ''; }, 2000);
  });
});
