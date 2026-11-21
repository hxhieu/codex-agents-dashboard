package com.codexagents.dashboard;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.IOException;
import java.net.Inet4Address;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class DashboardActivity extends Activity {
  private static final String TAG = "CodexDashboard";
  private static final String LOOPBACK = "127.0.0.1";
  private static final String HOME = "http://" + LOOPBACK + ":" + DashboardServer.PORT + "/";
  private static final String LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK";
  private static final int LAN_REQUEST = 1;
  private static final int HTTP_TIMEOUT_MS = 2000;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final Map<Network, String> wifiAddresses = new LinkedHashMap<>();
  private ConnectivityManager connectivity;
  private ConnectivityManager.NetworkCallback wifiCallback;
  private FrameLayout root;
  private TextView status;
  private WebView web;
  private boolean requestedPermission;
  private volatile int generation;
  private boolean visible;
  // The worker owns the listeners and serializes their start and stop operations.
  private HookNormalizer normalizer;
  private LiveStream stream;
  private DashboardServer local;
  private DashboardServer lan;
  private String lanAddress;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    connectivity = getSystemService(ConnectivityManager.class);
    root = new FrameLayout(this);
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return WindowInsets.CONSUMED;
    });
    status = new TextView(this);
    status.setGravity(Gravity.CENTER);
    status.setPadding(24, 24, 24, 24);
    web = createWebView();
    showStatus("Starting dashboard…");
    setContentView(root);
  }

  @Override
  protected void onStart() {
    super.onStart();
    visible = true;
    int current = ++generation;
    showStatus("Starting dashboard…");
    worker.execute(() -> startDashboard(current));
    watchWifi();
    if (!hasLanPermission() && !requestedPermission) {
      requestedPermission = true;
      requestPermissions(new String[] {LOCAL_NETWORK}, LAN_REQUEST);
    }
  }

  @Override
  protected void onStop() {
    visible = false;
    generation++;
    if (wifiCallback != null) {
      connectivity.unregisterNetworkCallback(wifiCallback);
      wifiCallback = null;
    }
    wifiAddresses.clear();
    web.stopLoading();
    web.loadUrl("about:blank");
    worker.execute(this::stopDashboard);
    super.onStop();
  }

  @Override
  protected void onDestroy() {
    root.removeAllViews();
    web.destroy();
    worker.shutdown();
    super.onDestroy();
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode == LAN_REQUEST && visible) watchWifi();
  }

  private boolean hasLanPermission() {
    return Build.VERSION.SDK_INT < 37 || checkSelfPermission(LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED;
  }

  private void watchWifi() {
    if (!hasLanPermission()) {
      updateWifi();
      return;
    }
    if (wifiCallback != null) return;
    wifiCallback = new ConnectivityManager.NetworkCallback() {
      @Override
      public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
        if (this != wifiCallback) return;
        wifiAddresses.remove(network);
        for (LinkAddress link : properties.getLinkAddresses()) {
          if (link.getAddress() instanceof Inet4Address) {
            wifiAddresses.put(network, link.getAddress().getHostAddress());
            break;
          }
        }
        updateWifi();
      }

      @Override
      public void onLost(Network network) {
        if (this != wifiCallback) return;
        wifiAddresses.remove(network);
        updateWifi();
      }
    };
    NetworkRequest request = new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build();
    connectivity.registerNetworkCallback(request, wifiCallback, new Handler(Looper.getMainLooper()));
    updateWifi();
  }

  private void updateWifi() {
    int current = generation;
    boolean allowed = hasLanPermission();
    String address = wifiAddresses.values().stream().findFirst().orElse(null);
    worker.execute(() -> {
      if (current == generation && stream != null) updateReceiver(allowed ? address : null, allowed);
    });
  }

  private void startDashboard(int current) {
    if (current != generation) return;
    try {
      if (normalizer == null) normalizer = new HookNormalizer(getAssets());
      stream = new LiveStream();
      local = new DashboardServer(LOOPBACK, getAssets(), normalizer, stream, true);
      local.start(HTTP_TIMEOUT_MS);
      runOnUiThread(() -> {
        if (current != generation) return;
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl(HOME);
      });
    } catch (IOException | RuntimeException error) {
      stopDashboard();
      Log.e(TAG, "Unable to start the dashboard", error);
      runOnUiThread(() -> {
        if (current == generation) showStatus("Couldn’t start the dashboard. Reopen the app to retry.");
      });
    }
  }

  private void updateReceiver(String address, boolean allowed) {
    if (lan != null && lanAddress.equals(address)) return;
    stopLan();
    if (address == null) {
      stream.setReceiver(null, allowed ? "Connect to Wi-Fi to receive hooks." : "Allow local network access in Android settings.");
      return;
    }
    try {
      lan = new DashboardServer(address, getAssets(), normalizer, stream, false);
      lan.start(HTTP_TIMEOUT_MS);
      lanAddress = address;
      stream.setReceiver("http://" + address + ":" + DashboardServer.PORT + "/api/events", "");
    } catch (IOException error) {
      stopLan();
      Log.w(TAG, "Unable to bind the Wi-Fi receiver", error);
      stream.setReceiver(null, "Couldn’t start the Wi-Fi receiver. Reopen the app to retry.");
    }
  }

  private void stopLan() {
    if (lan != null) lan.stop();
    lan = null;
    lanAddress = null;
  }

  private void stopDashboard() {
    stopLan();
    if (stream != null) stream.close();
    if (local != null) local.stop();
    stream = null;
    local = null;
  }

  private void showStatus(String text) {
    status.setText(text);
    root.removeAllViews();
    root.addView(status, new FrameLayout.LayoutParams(-1, -1));
  }

  private WebView createWebView() {
    WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
    WebView view = new WebView(this);
    WebSettings settings = view.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    view.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return request.isForMainFrame() && !request.getUrl().toString().startsWith(HOME);
      }
    });
    return view;
  }
}
