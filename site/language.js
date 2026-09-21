(() => {
  const storageKey = "palimpsest-language";
  let preferredLanguage = null;

  try {
    preferredLanguage = window.localStorage.getItem(storageKey);
  } catch {
    // Language detection still works when storage is unavailable.
  }

  if (preferredLanguage !== "en" && preferredLanguage !== "zh-CN") {
    const browserLanguages = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    preferredLanguage = browserLanguages.some((language) => language?.toLowerCase().startsWith("zh"))
      ? "zh-CN"
      : "en";
  }

  const baseUrl = new URL("./", window.location.href);
  const destination = new URL(preferredLanguage === "zh-CN" ? "zh/" : "en/", baseUrl);
  window.location.replace(destination.href);
})();
