// Navigation helpers shared by screens that may be opened without a back stack
// (cold start, DEV reload, notification or deep link).

export function goBackOrReplace(router, fallbackRoute) {
  if (router?.canGoBack?.()) {
    router.back();
    return 'back';
  }

  router.replace(fallbackRoute);
  return 'replace';
}
