package org.nodejs.mobile;

import android.content.Context;
import android.util.Log;

public class NodeJSBundle {
    private static final String TAG = "NodeJSBundle";
    private static boolean sLibraryLoaded = false;
    private final String[] mArguments;
    private final Context mContext;
    private boolean mIsRunning = false;

    static {
        try {
            System.loadLibrary("nodejs-server-native-lib");
            sLibraryLoaded = true;
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load native library: " + e.getMessage());
            sLibraryLoaded = false;
        }
    }

    public NodeJSBundle(Context context, String[] arguments) {
        mContext = context;
        mArguments = arguments != null ? arguments : new String[]{"server.js"};
    }

    public void startNodeJS() {
        if (!sLibraryLoaded) {
            throw new IllegalStateException("Native library not loaded. Check if libnode.so is available for this architecture.");
        }
        if (mIsRunning) {
            Log.d(TAG, "Node.js already running");
            return;
        }

        Log.d(TAG, "Starting Node.js with arguments: " + java.util.Arrays.toString(mArguments));
        
        // Call native method to start Node.js
        int result = startNodeWithArguments(mArguments);
        if (result == 0) {
            mIsRunning = true;
            Log.d(TAG, "Node.js started successfully");
        } else {
            Log.e(TAG, "Failed to start Node.js, result: " + result);
            throw new RuntimeException("Failed to start Node.js");
        }
    }

    public void stopNodeJS() {
        if (!mIsRunning) {
            return;
        }
        stopNode();
        mIsRunning = false;
        Log.d(TAG, "Node.js stopped");
    }

    // Called from native code via JNI
    public void logFromNative(String message) {
        Log.d(TAG, "[NodeJS] " + message);
    }

    // Native methods
    private native int startNodeWithArguments(String[] arguments);
    private native void stopNode();
    private native void redirectOutputToLogcat(boolean enable);

    // Compatibility methods for existing code
    public Object getGlobal(String name) {
        // This is a simplified implementation
        // The original NodeJSBundle had a more complex API for accessing JS globals
        Log.w(TAG, "getGlobal(" + name + ") called - limited implementation");
        return new JSObjectWrapper(name);
    }

    // Simple wrapper for JS objects
    public static class JSObjectWrapper {
        private final String mName;

        public JSObjectWrapper(String name) {
            mName = name;
        }

        public JSFunctionWrapper getFunction(String name) {
            return new JSFunctionWrapper(mName + "." + name);
        }
    }

    public static class JSFunctionWrapper {
        private final String mName;

        public JSFunctionWrapper(String name) {
            mName = name;
        }

        public void call(FunctionCallback callback) {
            Log.w(TAG, "JS function " + mName + " called - not implemented in native bridge");
        }
    }

    @FunctionalInterface
    public interface FunctionCallback {
        void call(Object... args);
    }
}
