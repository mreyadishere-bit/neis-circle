package site.neiscircle.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static volatile boolean appForeground = false;
    private static final String SITE_URL = "https://neiscircle.site/";
    private static final int REQUEST_NOTIFICATIONS = 5001;
    private static final int REQUEST_FILE = 5002;
    private static final int REQUEST_MEDIA = 5003;
    private static final int REQUEST_EXPLICIT_MEDIA = 5004;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMediaRequest;
    private String pendingExplicitMediaKind;
    private boolean pageReady = false;
    private String pendingRoute;
    private String pendingAuthUrl;
    private int nativeTopInset = 0;
    private int nativeBottomInset = 0;
    private long backgroundedAtMs = 0L;
    private boolean updateCheckRunning = false;
    private boolean nativeUpdateCheckRunning = false;
    private File pendingInstallApk;

    public static boolean isAppForeground() {
        return appForeground;
    }

    @Override
    protected void onStart() {
        super.onStart();
        appForeground = true;
    }

    @Override
    protected void onStop() {
        appForeground = false;
        super.onStop();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String savedSystemTheme = getSharedPreferences("neis_mobile", MODE_PRIVATE)
            .getString("system_theme", "light");
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(Color.parseColor("#F3F6F2"));
        getWindow().setNavigationBarColor(Color.parseColor("#F3F6F2"));
        applySystemTheme(savedSystemTheme);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        NotificationHelper.createChannels(this);

        webView = new WebView(this);
        setContentView(webView);
        applySystemTheme(savedSystemTheme);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
            Insets barsInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            nativeTopInset = barsInsets.top;
            nativeBottomInset = barsInsets.bottom;
            applyNativeInsets();
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " NEISCircleAndroid/1.7");

        webView.clearCache(true);
        webView.addJavascriptInterface(new NativeBridge(), "NeisAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(Intent.createChooser(intent, "Choose file"), REQUEST_FILE);
                    return true;
                } catch (Exception error) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebMediaPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMediaRequest == request) pendingMediaRequest = null;
                request.deny();
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> openExternal(url));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                applyNativeInsets();
                flushPendingEvents();
                webView.postDelayed(MainActivity.this::checkForNativeAppUpdate, 1200L);
            }
        });

        handleIntent(getIntent());
        webView.loadUrl(SITE_URL + "?native=1.7");
    }

    private void checkForNativeAppUpdate() {
        if (nativeUpdateCheckRunning) return;
        nativeUpdateCheckRunning = true;
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL("https://api.github.com/repos/mreyadishere-bit/neis-circle/releases/latest");
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "NEIS-Circle-Android");
                if (connection.getResponseCode() != 200) return;

                StringBuilder jsonBuilder = new StringBuilder();
                try (InputStream input = connection.getInputStream();
                     java.io.BufferedReader reader = new java.io.BufferedReader(
                         new java.io.InputStreamReader(input, java.nio.charset.StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) jsonBuilder.append(line);
                }
                String json = jsonBuilder.toString();
                JSONObject release = new JSONObject(json);
                String tag = release.optString("tag_name", "");
                int latestCode = 0;
                if (tag.startsWith("android-")) {
                    try { latestCode = Integer.parseInt(tag.substring("android-".length())); }
                    catch (Exception ignored) { }
                }
                if (latestCode <= BuildConfig.VERSION_CODE) return;

                String apkUrl = null;
                org.json.JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.optJSONObject(i);
                        if (asset != null && "neis-circle-android.apk".equals(asset.optString("name"))) {
                            apkUrl = asset.optString("browser_download_url", null);
                            break;
                        }
                    }
                }
                if (apkUrl == null || apkUrl.isEmpty()) return;

                final String versionLabel = release.optString("name", "New Android update");
                final String finalApkUrl = apkUrl;
                runOnUiThread(() -> showNativeUpdatePrompt(versionLabel, finalApkUrl));
            } catch (Exception ignored) {
            } finally {
                if (connection != null) connection.disconnect();
                nativeUpdateCheckRunning = false;
            }
        }).start();
    }

    private void showNativeUpdatePrompt(String versionLabel, String apkUrl) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
            .setTitle("Update available")
            .setMessage(versionLabel + "\n\nA newer NEIS Circle app is available. Update now to get the latest fixes and features. Your account and app data will stay in place.")
            .setNegativeButton("Later", null)
            .setPositiveButton("Update", (dialog, which) -> downloadAndInstallUpdate(apkUrl))
            .show();
    }

    private void downloadAndInstallUpdate(String apkUrl) {
        Toast.makeText(this, "Downloading NEIS Circle update…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                File dir = new File(getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("update_dir");
                File apk = new File(dir, "neis-circle-update.apk");
                if (apk.exists()) apk.delete();

                URL url = new URL(apkUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "NEIS-Circle-Android");
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new Exception("download_" + code);

                try (InputStream input = connection.getInputStream();
                     FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[32768];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                }

                if (!apk.exists() || apk.length() < 1024 * 100) throw new Exception("apk_invalid");
                runOnUiThread(() -> prepareApkInstall(apk));
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this,
                    "The update could not be downloaded. Try again later.", Toast.LENGTH_LONG).show());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private void prepareApkInstall(File apk) {
        pendingInstallApk = apk;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this)
                .setTitle("Allow app updates")
                .setMessage("Android needs permission to install NEIS Circle updates downloaded from the official app. Enable “Allow from this source”, then return here.")
                .setNegativeButton("Cancel", (dialog, which) -> pendingInstallApk = null)
                .setPositiveButton("Open settings", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                })
                .show();
            return;
        }
        pendingInstallApk = null;
        launchApkInstaller(apk);
    }

    private void launchApkInstaller(File apk) {
        try {
            Uri uri = androidx.core.content.FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception error) {
            Toast.makeText(this, "Could not open the Android update installer.", Toast.LENGTH_LONG).show();
        }
    }

    private void checkForWebUpdate() {
        if (!pageReady || webView == null || updateCheckRunning) return;
        updateCheckRunning = true;
        final String script =
            "(async function(){try{" +
            "const fresh=await fetch('/index.html?__neis_update='+Date.now(),{cache:'no-store',credentials:'same-origin'});" +
            "if(!fresh.ok)return 'skip';" +
            "const html=await fresh.text();" +
            "const parsed=new DOMParser().parseFromString(html,'text/html');" +
            "const clean=u=>{try{const x=new URL(u,location.href);return x.pathname+x.search}catch(e){return String(u||'')}};" +
            "const wanted=[...parsed.querySelectorAll('script[src],link[rel=\\\"stylesheet\\\"][href]')]" +
            ".map(el=>clean(el.src||el.href)).filter(x=>x&&x.includes('?v=')).sort();" +
            "const current=[...document.querySelectorAll('script[src],link[rel=\\\"stylesheet\\\"][href]')]" +
            ".map(el=>clean(el.src||el.href)).filter(x=>x&&x.includes('?v=')).sort();" +
            "const a=wanted.join('|'),b=current.join('|');" +
            "if(a&&b&&a!==b){location.reload();return 'reloaded'}" +
            "return 'same';" +
            "}catch(e){return 'error'}})();";
        webView.evaluateJavascript(script, value -> updateCheckRunning = false);
    }

    @Override
    protected void onPause() {
        backgroundedAtMs = System.currentTimeMillis();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (pendingInstallApk != null && pendingInstallApk.exists() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls())) {
            File apk = pendingInstallApk;
            pendingInstallApk = null;
            webView.postDelayed(() -> launchApkInstaller(apk), 250L);
        }
        if (backgroundedAtMs <= 0L) return;
        long awayFor = System.currentTimeMillis() - backgroundedAtMs;
        backgroundedAtMs = 0L;
        if (awayFor < 1500L || webView == null) return;
        webView.postDelayed(this::checkForWebUpdate, 350L);
    }

    private void applySystemTheme(String theme) {
        boolean dark = "dark".equalsIgnoreCase(theme);
        getSharedPreferences("neis_mobile", MODE_PRIVATE)
            .edit().putString("system_theme", dark ? "dark" : "light").apply();

        WindowInsetsControllerCompat bars =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (bars != null) {
            bars.setAppearanceLightStatusBars(!dark);
            bars.setAppearanceLightNavigationBars(!dark);
        }
        int chromeColor = Color.parseColor(dark ? "#0D1512" : "#F3F6F2");
        getWindow().setStatusBarColor(chromeColor);
        getWindow().setNavigationBarColor(chromeColor);
        if (webView != null) {
            webView.setBackgroundColor(chromeColor);
        }
    }

    private void applyNativeInsets() {
        if (!pageReady || webView == null) return;
        String script = "document.documentElement.style.setProperty('--native-safe-top','" + nativeTopInset +
            "px');document.documentElement.style.setProperty('--native-safe-bottom','" + nativeBottomInset + "px');";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        String host = uri.getHost() == null ? "" : uri.getHost();

        if ("neiscircle".equalsIgnoreCase(scheme) && "delete-message".equalsIgnoreCase(host)) {
            final String scope = uri.getQueryParameter("scope");
            final String messageId = uri.getQueryParameter("id");
            if (webView != null && messageId != null && !messageId.isEmpty()) {
                final String safeScope = "circle".equalsIgnoreCase(scope) ? "circle" : "dm";
                final String script = "window.neisDeleteMessageNow&&window.neisDeleteMessageNow(" +
                    JSONObject.quote(safeScope) + "," + JSONObject.quote(messageId) + ",null);";
                webView.post(() -> webView.evaluateJavascript(script, null));
            }
            return true;
        }

        if ("neiscircle".equalsIgnoreCase(scheme)) {
            pendingAuthUrl = uri.toString();
            flushPendingEvents();
            return true;
        }

        if ("https".equalsIgnoreCase(scheme) &&
            ("neiscircle.site".equalsIgnoreCase(host) || "www.neiscircle.site".equalsIgnoreCase(host))) {
            return false;
        }

        openExternal(uri.toString());
        return true;
    }

    private void openExternal(String url) {
        runOnUiThread(() -> {
            try {
                new CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url));
            } catch (Exception error) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
        });
    }

    private void handleWebMediaPermission(PermissionRequest request) {
        if (request == null) return;

        boolean wantsAudio = false;
        boolean wantsVideo = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) wantsAudio = true;
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
        }

        java.util.ArrayList<String> missing = new java.util.ArrayList<>();
        if (wantsAudio &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (wantsVideo &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }

        if (missing.isEmpty()) {
            grantAllowedWebMediaResources(request);
            return;
        }

        if (pendingMediaRequest != null && pendingMediaRequest != request) {
            pendingMediaRequest.deny();
        }
        pendingMediaRequest = request;
        ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQUEST_MEDIA);
    }

    private void grantAllowedWebMediaResources(PermissionRequest request) {
        if (request == null) return;
        java.util.ArrayList<String> allowed = new java.util.ArrayList<>();

        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(resource);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                allowed.add(resource);
            }
        }

        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    private boolean hasMediaPermission(String kind) {
        if ("microphone".equalsIgnoreCase(kind) || "audio".equalsIgnoreCase(kind)) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }
        if ("camera".equalsIgnoreCase(kind) || "video".equalsIgnoreCase(kind)) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        }
        return false;
    }

    private void requestExplicitMediaPermission(String kind) {
        runOnUiThread(() -> {
            final boolean microphone = "microphone".equalsIgnoreCase(kind) || "audio".equalsIgnoreCase(kind);
            final boolean camera = "camera".equalsIgnoreCase(kind) || "video".equalsIgnoreCase(kind);
            if (!microphone && !camera) return;

            if (hasMediaPermission(kind)) {
                sendExplicitMediaPermissionResult(microphone ? "microphone" : "camera", true, true);
                return;
            }

            pendingExplicitMediaKind = microphone ? "microphone" : "camera";
            String permission = microphone ? Manifest.permission.RECORD_AUDIO : Manifest.permission.CAMERA;
            ActivityCompat.requestPermissions(this, new String[]{permission}, REQUEST_EXPLICIT_MEDIA);
        });
    }

    private void sendExplicitMediaPermissionResult(String kind, boolean granted, boolean canAskAgain) {
        if (!pageReady || webView == null) return;
        final String script = "window.neisMeetingNativePermissionResult&&window.neisMeetingNativePermissionResult(" +
            JSONObject.quote(kind) + "," + granted + "," + canAskAgain + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void requestPushToken() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                boolean prompted = getSharedPreferences("neis_mobile", MODE_PRIVATE)
                    .getBoolean("notification_prompted", false);
                if (!prompted) {
                    getSharedPreferences("neis_mobile", MODE_PRIVATE)
                        .edit().putBoolean("notification_prompted", true).apply();
                    ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
                }
                return;
            }
            deliverCurrentToken();
        });
    }

    private void deliverCurrentToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) return;
            String token = task.getResult();
            getSharedPreferences("neis_mobile", MODE_PRIVATE).edit().putString("fcm_token", token).apply();
            sendTokenToWeb(token);
        });
    }

    private void sendTokenToWeb(String token) {
        if (!pageReady || token == null || token.isEmpty()) return;
        String script = "window.NEISMobile&&window.NEISMobile.receivePushToken(" + JSONObject.quote(token) + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void flushPendingEvents() {
        if (!pageReady || webView == null) return;

        String savedToken = getSharedPreferences("neis_mobile", MODE_PRIVATE).getString("fcm_token", "");
        if (!savedToken.isEmpty()) sendTokenToWeb(savedToken);

        if (pendingRoute != null && !pendingRoute.isEmpty()) {
            String route = pendingRoute;
            pendingRoute = null;
            webView.evaluateJavascript(
                "window.NEISMobile&&window.NEISMobile.openRoute(" + JSONObject.quote(route) + ");", null);
        }

        if (pendingAuthUrl != null && !pendingAuthUrl.isEmpty()) {
            String url = pendingAuthUrl;
            pendingAuthUrl = null;
            webView.evaluateJavascript(
                "window.NEISMobile&&window.NEISMobile.handleAuthCallback(" + JSONObject.quote(url) + ");", null);
        }
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "neiscircle".equalsIgnoreCase(data.getScheme())) {
            pendingAuthUrl = data.toString();
        }
        String route = intent.getStringExtra("route");
        if (route != null && !route.isEmpty()) pendingRoute = route;
        flushPendingEvents();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return !!(window.NEISMobile&&window.NEISMobile.handleNativeBack&&window.NEISMobile.handleNativeBack())}catch(e){return false}})()",
            handled -> {
                if ("true".equals(handled)) return;
                fallbackBackNavigation();
            }
        );
    }

    private void fallbackBackNavigation() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_NOTIFICATIONS && results.length > 0 &&
            results[0] == PackageManager.PERMISSION_GRANTED) {
            deliverCurrentToken();
            return;
        }

        if (requestCode == REQUEST_MEDIA) {
            PermissionRequest request = pendingMediaRequest;
            pendingMediaRequest = null;
            if (request != null) grantAllowedWebMediaResources(request);
            return;
        }

        if (requestCode == REQUEST_EXPLICIT_MEDIA) {
            String kind = pendingExplicitMediaKind;
            pendingExplicitMediaKind = null;
            if (kind == null) return;
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            String permission = "microphone".equals(kind) ? Manifest.permission.RECORD_AUDIO : Manifest.permission.CAMERA;
            boolean canAskAgain = granted || ActivityCompat.shouldShowRequestPermissionRationale(this, permission);
            sendExplicitMediaPermissionResult(kind, granted, canAskAgain);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    public class NativeBridge {
        @JavascriptInterface public boolean isNative() { return true; }
        @JavascriptInterface public void openExternal(String url) { MainActivity.this.openExternal(url); }
        @JavascriptInterface public void requestPushToken() { MainActivity.this.requestPushToken(); }
        @JavascriptInterface public boolean hasMediaPermission(String kind) { return MainActivity.this.hasMediaPermission(kind); }
        @JavascriptInterface public void requestMediaPermission(String kind) { MainActivity.this.requestExplicitMediaPermission(kind); }
        @JavascriptInterface public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }
        @JavascriptInterface public void pushRegistrationComplete() { }
        @JavascriptInterface public void setSystemTheme(String theme) {
            runOnUiThread(() -> MainActivity.this.applySystemTheme(theme));
        }
        @JavascriptInterface public void openNotificationSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                startActivity(intent);
            });
        }
    }
}
