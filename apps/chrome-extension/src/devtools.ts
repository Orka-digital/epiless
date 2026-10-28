chrome.devtools.panels
  .create('epi-less', '', 'panel.html')
  .catch((error: unknown) => {
    console.error('Could not open the epi-less DevTools panel.', error);
  });
