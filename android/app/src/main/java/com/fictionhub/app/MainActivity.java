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
    
    // Note: In Capacitor 8, plugins are auto-discovered via @CapacitorPlugin annotation.
    // The NodeJSServerPlugin will be loaded automatically.
    // To start the Node.js server, call the "startServer" method from JavaScript:
    //   const { NodeJSServer } = Capacitor.Plugins;
    //   await NodeJSServer.startServer();
    //
    // Or use the Capacitor App lifecycle event:
    //   import { App } from '@capacitor/app';
    //   App.addListener('appStateChange', ({ isActive }) => {
    //     if (isActive) { NodeJSServer.startServer(); }
    //   });
}
