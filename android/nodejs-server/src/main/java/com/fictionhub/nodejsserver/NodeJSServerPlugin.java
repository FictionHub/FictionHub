package com.fictionhub.nodejsserver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;

import org.nodejs.mobile.NodeJSBundle;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "NodeJSServer")
public class NodeJSServerPlugin extends Plugin {

    private static final String TAG = "NodeJSServer";
    private static final String CHANNEL_ID = "FictionHubServer";
    private static final int NOTIFICATION_ID = 1001;

    private NodeJSBundle nodeJSBundle;
    private boolean isServerRunning = false;
    private Thread serverThread;

    @PluginMethod
    public void startServer(PluginCall call) {
        Log.d(TAG, "startServer called");
        
        if (isServerRunning) {
            Log.d(TAG, "Server already running");
            call.resolve();
            return;
        }

        // Create notification channel for Android 8+
        createNotificationChannel();

        // Start foreground service
        Intent serviceIntent = new Intent(getContext(), NodeJSServerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                getContext().startForegroundService(serviceIntent);
                Log.d(TAG, "Foreground service started");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start foreground service", e);
                call.reject("Failed to start foreground service: " + e.getMessage());
                return;
            }
        } else {
            try {
                getContext().startService(serviceIntent);
                Log.d(TAG, "Service started (pre-O)");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start service", e);
                call.reject("Failed to start service: " + e.getMessage());
                return;
            }
        }

        // Copy server files and start Node.js
        serverThread = new Thread(() -> {
            try {
                Log.d(TAG, "Copying server files...");
                copyServerFiles();
                Log.d(TAG, "Server files copied, starting Node.js...");
                startNodeJSServer();
                
                // Verify Node.js is actually running
                if (nodeJSBundle != null && nodeJSBundle.isRunning()) {
                    isServerRunning = true;
                    Log.d(TAG, "Node.js server started successfully and verified running");
                    call.resolve();
                } else {
                    Log.e(TAG, "Node.js bundle reports not running after start");
                    isServerRunning = false;
                    call.reject("Node.js failed to start properly");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start server", e);
                isServerRunning = false;
                call.reject("Failed to start server: " + e.getMessage());
            }
        });
        serverThread.setUncaughtExceptionHandler((t, e) -> {
            Log.e(TAG, "Uncaught exception in server thread", e);
            isServerRunning = false;
        });
        serverThread.start();
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        Log.d(TAG, "stopServer called");
        
        if (!isServerRunning && (nodeJSBundle == null || !nodeJSBundle.isRunning())) {
            Log.d(TAG, "Server not running");
            call.resolve();
            return;
        }

        if (nodeJSBundle != null) {
            try {
                if (nodeJSBundle.isRunning()) {
                    nodeJSBundle.stopNodeJS();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error stopping Node.js", e);
            }
            nodeJSBundle = null;
        }

        isServerRunning = false;

        // Stop the service
        try {
            getContext().stopService(new Intent(getContext(), NodeJSServerService.class));
        } catch (Exception e) {
            Log.w(TAG, "Error stopping service", e);
        }
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", isServerRunning);
        if (nodeJSBundle != null) {
            result.put("nodeRunning", nodeJSBundle.isRunning());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void restartServer(PluginCall call) {
        Log.d(TAG, "restartServer called");
        stopServer(new PluginCall() {
            @Override
            public void resolve() {
                // Small delay to ensure stop completes
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    startServer(call);
                }, 500);
            }
            @Override
            public void reject(String error) {
                call.reject(error);
            }
            @Override
            public void resolve(JSObject data) {
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    startServer(call);
                }, 500);
            }
            @Override
            public String getMethodName() { return "restartServer"; }
            @Override
            public String getCallbackId() { return call.getCallbackId(); }
            @Override
            public JSObject getData() { return call.getData(); }
        });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "FictionHub Local Server",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Runs the local FictionHub media server");
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                Log.d(TAG, "Notification channel created");
            }
        }
    }

    private void copyServerFiles() throws Exception {
        File destDir = new File(getContext().getFilesDir(), "server");
        if (!destDir.exists()) {
            destDir.mkdirs();
            Log.d(TAG, "Created server directory: " + destDir.getAbsolutePath());
        }

        // Copy server.js and all dependencies from assets
        String[] files = getContext().getAssets().list("server");
        if (files != null && files.length > 0) {
            Log.d(TAG, "Found " + files.length + " files in assets/server");
            for (String file : files) {
                copyAssetFile("server/" + file, new File(destDir, file));
            }
        } else {
            Log.w(TAG, "No files found in assets/server");
        }

        // Also copy node_modules if present in assets
        String[] nodeModulesFiles = getContext().getAssets().list("server/node_modules");
        if (nodeModulesFiles != null) {
            File nodeModulesDest = new File(destDir, "node_modules");
            if (!nodeModulesDest.exists()) {
                nodeModulesDest.mkdirs();
            }
            for (String file : nodeModulesFiles) {
                copyAssetFile("server/node_modules/" + file, new File(nodeModulesDest, file));
            }
            Log.d(TAG, "Copied node_modules");
        } else {
            Log.w(TAG, "No node_modules found in assets");
        }
    }

    private void copyAssetFile(String assetPath, File destFile) throws Exception {
        Log.d(TAG, "Copying asset: " + assetPath + " -> " + destFile.getAbsolutePath());
        try (InputStream in = getContext().getAssets().open(assetPath);
             FileOutputStream out = new FileOutputStream(destFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private void startNodeJSServer() {
        File serverDir = new File(getContext().getFilesDir(), "server");
        File serverJs = new File(serverDir, "server.js");

        if (!serverJs.exists()) {
            throw new IllegalStateException("server.js not found at: " + serverJs.getAbsolutePath());
        }

        // Prepare arguments for Node.js
        String[] args = new String[]{"server.js"};

        // Environment variables (also set in native code)
        String dataDir = getContext().getFilesDir().getAbsolutePath();
        String videoDir = getContext().getExternalFilesDir(null) + "/FictionHub/Video Downloads";
        String mangaDir = getContext().getExternalFilesDir(null) + "/FictionHub/Manga Downloads";

        System.setProperty("FH_DATA_DIR", dataDir);
        System.setProperty("FH_VIDEO_DIR", videoDir);
        System.setProperty("FH_MANGA_DIR", mangaDir);
        System.setProperty("PORT", "8787");

        // Initialize Node.js
        Log.d(TAG, "Creating NodeJSBundle with args: " + java.util.Arrays.toString(args));
        nodeJSBundle = new NodeJSBundle(getContext(), args);
        nodeJSBundle.startNodeJS();

        // Redirect console.log to Android log
        // Note: This requires the JSObjectWrapper implementation to work
        try {
            nodeJSBundle.getGlobal("console").getFunction("log").call((msg) -> {
                Log.d(TAG, "[NodeJS] " + msg);
            });
        } catch (Exception e) {
            Log.w(TAG, "Could not set up console.log redirect: " + e.getMessage());
        }
    }

    // Static inner class for the foreground service
    public static class NodeJSServerService extends Service {
        private static final String TAG = "NodeJSServerService";

        @Override
        public void onCreate() {
            super.onCreate();
            Log.d(TAG, "Service created");
        }

        @Override
        public int onStartCommand(Intent intent, int flags, int startId) {
            Log.d(TAG, "Service onStartCommand");
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("FictionHub Server")
                .setContentText("Local media server running")
                .setSmallIcon(R.drawable.ic_notification)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();

            startForeground(NOTIFICATION_ID, notification);
            return START_STICKY;
        }

        @Override
        public void onDestroy() {
            super.onDestroy();
            Log.d(TAG, "Service destroyed");
        }

        @Override
        public IBinder onBind(Intent intent) {
            return null;
        }
    }
}
