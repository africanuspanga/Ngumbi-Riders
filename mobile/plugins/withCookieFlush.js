/*
 * Keep riders signed in (2026-10-30).
 *
 * Android's WebView writes cookies to disk lazily (roughly every 30 seconds).
 * If Android closes the app before that — which low-memory phones do as soon
 * as the rider switches to another app — the fresh sign-in cookie is lost and
 * the rider has to log in again. Found on the emulator: log in, close the app
 * within half a minute, reopen → back at the login page.
 *
 * Flushing the cookie store whenever the app goes to the background makes the
 * session durable. The sign-in cookie itself already lasts 400 days.
 */
const { withMainActivity } = require('expo/config-plugins');

const MARKER = '// @ngumbi cookie-flush';

module.exports = function withCookieFlush(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withCookieFlush expects a Kotlin MainActivity');
    }
    const method = `
  ${MARKER}
  override fun onPause() {
    super.onPause()
    android.webkit.CookieManager.getInstance().flush()
  }
`;
    const idx = src.lastIndexOf('}');
    src = src.slice(0, idx) + method + src.slice(idx);
    cfg.modResults.contents = src;
    return cfg;
  });
};
