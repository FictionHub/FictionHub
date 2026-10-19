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
        if (isServerRunning) {
            call.resolve();
            return;
        }

        // Create notification channel for Android 8+
        createNotificationChannel();

        // Start foreground service
        Intent serviceIntent = new Intent(getContext(), NodeJSServerService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }

        // Copy server files and start Node.js
        new Thread(() -> {
            try {
                copyServerFiles();
                startNodeJSServer();
                isServerRunning = true;
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start server", e);
                call.reject("Failed to start server: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        if (!isServerRunning) {
            call.resolve();
            return;
        }

        if (nodeJSBundle != null) {
            nodeJSBundle.stopNodeJS();
            nodeJSBundle = null;
        }
        isServerRunning = false;

        // Stop the service
        getContext().stopService(new Intent(getContext(), NodeJSServerService.class));
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(new JSObject().put("running", isServerRunning));
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
            }
        }
    }

    private void copyServerFiles() throws Exception {
        File destDir = new File(getContext().getFilesDir(), "server");
        if (!destDir.exists()) {
            destDir.mkdirs();
        }

        // Copy server.js and all dependencies from assets
        String[] files = getContext().getAssets().list("server");
        if (files != null) {
            for (String file : files) {
                copyAssetFile("server/" + file, new File(destDir, file));
            }
        }

        // Also copy node_modules if needed
        File nodeModulesSrc = new File(getContext().getFilesDir(), "server/node_modules");
        if (!nodeModulesSrc.exists()) {
            // Node modules will be installed at build time or we bundle them
        }
    }

    private void copyAssetFile(String assetPath, File destFile) throws Exception {
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

        // Prepare arguments for Node.js
        String[] args = new String[]{"server.js"};

        // Environment variables
        String dataDir = getContext().getFilesDir().getAbsolutePath();
        String videoDir = getContext().getExternalFilesDir(null) + "/FictionHub/Video Downloads";
        String mangaDir = getContext().getExternalFilesDir(null) + "/FictionHub/Manga Downloads";

        System.setProperty("FH_DATA_DIR", dataDir);
        System.setProperty("FH_VIDEO_DIR", videoDir);
        System.setProperty("FH_MANGA_DIR", mangaDir);
        System.setProperty("PORT", "8787");

        // Initialize Node.js
        nodeJSBundle = new NodeJSBundle(getContext(), args);
        nodeJSBundle.startNodeJS();

        // Redirect console.log to Android log
        nodeJSBundle.getGlobal("console").getFunction("log").call((msg) -> {
            Log.d(TAG, "[NodeJS] " + msg);
        });
    }

    // Static inner class for the foreground service
    public static class NodeJSServerService extends Service {
        @Override
        public int onStartCommand(Intent intent, int flags, int startId) {
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
        public IBinder onBind(Intent intent) {
            return null;
        }
    }
}
