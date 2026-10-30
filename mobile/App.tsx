import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

/** The imperative methods the shell uses. */
type WebViewHandle = {
  goBack: () => void;
  injectJavaScript: (script: string) => void;
};
// react-native-webview 14 types WebView as a FunctionComponent without `ref`
// under React 19's types, although it forwards the ref at runtime.
const AppWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

/*
 * Ng'umbi Riders for Android.
 *
 * A native shell around the live site (www.ngumbi.co.tz). Every feature, every
 * money rule and every permission stays on the server, so a Vercel deploy
 * updates the app with no new APK. What the shell adds is what the browser
 * made hard for riders and the owner: an icon that opens straight into their
 * own area, a login that stays signed in, the Android back button, a plain
 * Swahili screen when there is no network, and phone/WhatsApp/USSD links and
 * downloads that leave the app the way people expect.
 */

const ORIGIN = 'https://www.ngumbi.co.tz';
// /app sends a signed-in owner, accountant or rider to their own area, and
// everybody else to the sign-in page.
const START_URL = `${ORIGIN}/app`;
const OUR_HOSTS = new Set(['www.ngumbi.co.tz', 'ngumbi.co.tz']);
const GREEN = '#2F8F46';
const BACKGROUND = '#F7F9F7';

SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden — nothing to do */
});

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/** Pages and API routes of our own site load inside the app. */
function isOurs(url: string): boolean {
  const host = hostOf(url);
  return host !== null && OUR_HOSTS.has(host);
}

/** Anything the WebView itself must handle (inline content, blank frames). */
function isInternalScheme(url: string): boolean {
  return /^(about:|data:|blob:|javascript:)/i.test(url);
}

function openOutside(url: string) {
  Linking.openURL(url).catch(() => {
    /* no app can open it — nothing useful to do */
  });
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const webview = useRef<WebViewHandle>(null);
  const canGoBack = useRef(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  // Android back: step back through the site, and only leave the app from the
  // first page.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && !failed) {
        webview.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [failed]);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  // Our own pages stay in the app (they need the sign-in session). Phone,
  // WhatsApp, USSD, maps and other websites open in the right Android app.
  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    if (isOurs(req.url) || isInternalScheme(req.url)) return true;
    openOutside(req.url);
    return false;
  }, []);

  // target="_blank" links and window.open(). Most of ours are receipts, PDFs
  // and documents under /api that need the session, so they load in the app
  // (Android then downloads files to the Downloads folder with the session
  // cookie). Signed storage links and other sites open outside.
  const onOpenWindow = useCallback((e: { nativeEvent: { targetUrl: string } }) => {
    const url = e.nativeEvent.targetUrl;
    if (isOurs(url)) {
      webview.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
    } else if (url) {
      openOutside(url);
    }
  }, []);

  const retry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    setKey((k) => k + 1);
  }, []);

  const hideSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      {failed ? (
        <Offline onRetry={retry} />
      ) : (
        <AppWebView
          key={key}
          ref={webview}
          source={{ uri: START_URL }}
          style={styles.webview}
          applicationNameForUserAgent="NgumbiApp/1.0"
          // Keep people signed in between launches.
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
          // Photos of documents: the site's <input type="file"> may use the camera.
          allowFileAccess
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          setSupportMultipleWindows
          onOpenWindow={onOpenWindow}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onNavigationStateChange={onNavigationStateChange}
          onLoadEnd={() => {
            setLoading(false);
            hideSplash();
          }}
          onError={() => {
            setFailed(true);
            setLoading(false);
            hideSplash();
          }}
          // A crashed renderer would otherwise leave a blank screen.
          onRenderProcessGone={retry}
          onContentProcessDidTerminate={retry}
          textZoom={100}
          overScrollMode="never"
          setBuiltInZoomControls={false}
        />
      )}
      {loading && !failed && (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator size="large" color={GREEN} />
        </View>
      )}
    </SafeAreaView>
  );
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineTitle}>Hakuna mtandao</Text>
      <Text style={styles.offlineBody}>
        Imeshindikana kufungua Ng&apos;umbi Riders. Hakikisha una data au Wi-Fi, kisha jaribu tena.
      </Text>
      <Text style={styles.offlineBodyEn}>No connection. Check your data or Wi-Fi and try again.</Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Jaribu tena</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GREEN },
  webview: { flex: 1, backgroundColor: BACKGROUND },
  loader: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(247,249,247,0.6)',
  },
  offline: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    backgroundColor: BACKGROUND,
  },
  offlineTitle: { fontSize: 22, fontWeight: '700', color: '#1B4D2A' },
  offlineBody: { fontSize: 16, textAlign: 'center', color: '#33413A' },
  offlineBodyEn: { fontSize: 13, textAlign: 'center', color: '#6B7A72' },
  button: {
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 32,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
