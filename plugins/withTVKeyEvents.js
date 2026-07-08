const { withMainActivity } = require('@expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

/**
 * Expo config plugin that injects D-pad key event forwarding into MainActivity.
 *
 * On Android TV, hardware D-pad events (left, right, up, down, select/enter)
 * are intercepted in dispatchKeyEvent and emitted to JavaScript via
 * DeviceEventEmitter as "onTVKeyEvent" events.
 *
 * On non-TV builds this code still compiles but never fires because TV
 * remotes aren't present, so phone / tablet builds are unaffected.
 */
function withTVKeyEvents(config) {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    // 1. Add imports after the existing imports
    const importsToAdd = [
      'import android.view.KeyEvent',
      'import com.facebook.react.ReactApplication',
      'import com.facebook.react.bridge.Arguments',
      'import com.facebook.react.modules.core.DeviceEventManagerModule',
    ];

    contents = mergeContents({
      tag: 'tv-key-events-imports',
      src: contents,
      anchor: /^import expo\.modules\.ReactActivityDelegateWrapper$/m,
      offset: 1,
      newSrc: '\n' + importsToAdd.join('\n'),
      comment: '//',
    }).contents;

    // 2. Add dispatchKeyEvent override before the closing brace of the class
    const dispatchKeyEventCode = `
  // @generated begin tv-key-events-dispatch — expo-config-plugin
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN) {
      val eventType = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "select"
        else -> null
      }
      if (eventType != null) {
        try {
          val reactContext = (application as? ReactApplication)
            ?.reactHost
            ?.currentReactContext
          reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onTVKeyEvent", Arguments.createMap().apply {
              putString("eventType", eventType)
              putInt("keyCode", event.keyCode)
            })
        } catch (_: Exception) {
          // React context not ready yet — ignore
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }
  // @generated end tv-key-events-dispatch`;

    contents = mergeContents({
      tag: 'tv-key-events-dispatch',
      src: contents,
      // Insert before invokeDefaultOnBackPressed (the last override before class end)
      anchor: /^\s+override fun invokeDefaultOnBackPressed\(\)/m,
      offset: 0,
      newSrc: dispatchKeyEventCode + '\n',
      comment: '//',
    }).contents;

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withTVKeyEvents;
