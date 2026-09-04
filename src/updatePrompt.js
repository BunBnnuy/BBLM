function createUpdatePromptOptions(version) {
  const label = typeof version === 'string' && version.trim() ? `Version ${version.trim()}` : 'A new version';
  return {
    type: 'info',
    buttons: ['Update now', 'Install when app closes'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "BB's LibMan — Update ready",
    message: `${label} is ready to install.`,
    detail: 'Update now closes and restarts the app. You can also keep working and install the update when the app fully exits.',
  };
}

function shouldInstallNow(result) {
  return !!result && result.response === 0;
}

module.exports = { createUpdatePromptOptions, shouldInstallNow };
