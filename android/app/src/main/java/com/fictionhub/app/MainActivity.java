package com.fictionhub.app;

import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.fictionhub.nodejsserver.NodeJSServerPlugin;

import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "FictionHubMainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Enable hardware acceleration for smooth video playback
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB) {
            getWindow().setFlags(
                android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
            );
        }
        
        // Keep screen on for video playback
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        
        Log.d(TAG, "FictionHub MainActivity created");
    }

    @Override
    protected ArrayList<Plugin> createPlugins() {
        ArrayList<Plugin> plugins = super.createPlugins();
        
        // Add our custom Node.js server plugin
        plugins.add(new NodeJSServerPlugin());
        
        return plugins;
    }

    @Override
    protected void onStart() {
        super.onStart();
        Log.d(TAG, "onStart - Starting Node.js server");
        
        // Start the local server automatically
        if (getBridge() != null) {
            getBridge().getPlugin("NodeJSServer").execute("startServer");
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        Log.d(TAG, "onStop");
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "onDestroy - Stopping Node.js server");
        
        // Stop the server when app is fully destroyed
        if (getBridge() != null) {
            getBridge().getPlugin("NodeJSServer").execute("stopServer");
        }
    }
}
