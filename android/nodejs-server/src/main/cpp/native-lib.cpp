/*
  Node.js for FictionHub - JNI layer
  Provides native methods for org.nodejs.mobile.NodeJSBundle
*/

#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dlfcn.h>

#include "node.h"

const char *ADBTAG = "FICTIONHUB-NODEJS";

// Cache JNIEnv for callback from Node.js
static JavaVM* g_jvm = nullptr;
static jobject g_nodejs_bundle_obj = nullptr;
static jmethodID g_log_method_id = nullptr;
static bool g_node_started = false;

extern "C" JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void* reserved) {
    g_jvm = vm;
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "JNI_OnLoad called");
    return JNI_VERSION_1_6;
}

// Helper to get JNIEnv for current thread
static JNIEnv* getJNIEnv() {
    JNIEnv* env = nullptr;
    if (g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
            __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to attach thread");
            return nullptr;
        }
    }
    return env;
}

// Native method: startNodeWithArguments
extern "C" JNIEXPORT jint JNICALL
Java_org_nodejs_mobile_NodeJSBundle_startNodeWithArguments(
    JNIEnv* env, jobject thiz, jobjectArray arguments) {

    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "startNodeWithArguments called");

    if (g_node_started) {
        __android_log_print(ANDROID_LOG_WARN, ADBTAG, "Node.js already started");
        return 0;
    }

    // Cache the Java object for callbacks
    g_nodejs_bundle_obj = env->NewGlobalRef(thiz);
    if (!g_nodejs_bundle_obj) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to create global ref");
        return -1;
    }

    // Get the log method ID
    jclass cls = env->GetObjectClass(thiz);
    g_log_method_id = env->GetMethodID(cls, "logFromNative", "(Ljava/lang/String;)V");
    if (!g_log_method_id) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to find logFromNative method");
        env->DeleteLocalRef(cls);
        return -1;
    }
    env->DeleteLocalRef(cls);

    // Get filesDir from Java context
    cls = env->GetObjectClass(thiz);
    jmethodID getFilesDirId = env->GetMethodID(cls, "getFilesDir", "()Ljava/io/File;");
    if (!getFilesDirId) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to find getFilesDir method");
        return -1;
    }
    jobject filesDirObj = env->CallObjectMethod(thiz, getFilesDirId);
    if (!filesDirObj) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "getFilesDir returned null");
        return -1;
    }
    jclass fileClass = env->GetObjectClass(filesDirObj);
    jmethodID getAbsolutePathId = env->GetMethodID(fileClass, "getAbsolutePath", "()Ljava/lang/String;");
    if (!getAbsolutePathId) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to find getAbsolutePath method");
        return -1;
    }
    jstring filesDirPath = (jstring)env->CallObjectMethod(filesDirObj, getAbsolutePathId);
    if (!filesDirPath) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "getAbsolutePath returned null");
        return -1;
    }
    const char* nativeFilesDir = env->GetStringUTFChars(filesDirPath, 0);

    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Files dir: %s", nativeFilesDir);

    // Build server directory path
    std::string serverDir = std::string(nativeFilesDir) + "/server";

    // Ensure server directory exists
    struct stat st;
    if (stat(serverDir.c_str(), &st) != 0) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Server dir does not exist: %s, errno=%d", serverDir.c_str(), errno);
        env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);
        return -1;
    }
    if (!S_ISDIR(st.st_mode)) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Server path is not a directory: %s", serverDir.c_str());
        env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);
        return -1;
    }

    // Check for server.js
    std::string serverJsPath = serverDir + "/server.js";
    if (stat(serverJsPath.c_str(), &st) != 0) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "server.js not found at: %s", serverJsPath.c_str());
        env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);
        return -1;
    }

    // Get external files dir for video/manga
    std::string videoDir = std::string(nativeFilesDir) + "/FictionHub/Video Downloads";
    std::string mangaDir = std::string(nativeFilesDir) + "/FictionHub/Manga Downloads";

    // chdir to server directory BEFORE node::Start
    if (chdir(serverDir.c_str()) != 0) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "chdir failed: %s (errno=%d)", strerror(errno), errno);
        env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);
        return -1;
    }
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Changed working directory to: %s", serverDir.c_str());

    // Set required environment variables for Node.js process
    std::string nodePath = serverDir + ":" + serverDir + "/node_modules";
    setenv("NODE_PATH", nodePath.c_str(), 1);
    setenv("FH_DATA_DIR", nativeFilesDir, 1);
    setenv("PORT", "8787", 1);
    setenv("FH_VIDEO_DIR", videoDir.c_str(), 1);
    setenv("FH_MANGA_DIR", mangaDir.c_str(), 1);

    // Ensure directories exist
    mkdir(videoDir.c_str(), 0755);
    mkdir(mangaDir.c_str(), 0755);

    // Also try to set ICU data path if available
    std::string icuDataPath = serverDir + "/icudtl.dat";
    if (stat(icuDataPath.c_str(), &st) == 0) {
        setenv("ICU_DATA_DIR", serverDir.c_str(), 1);
        __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Found ICU data at: %s", icuDataPath.c_str());
    } else {
        __android_log_print(ANDROID_LOG_WARN, ADBTAG, "ICU data not found at: %s", icuDataPath.c_str());
    }

    env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);

    // argc to pass to Node.
    jsize argument_count = env->GetArrayLength(arguments);

    // Compute byte size need for all arguments in contiguous memory.
    int c_arguments_size = 0;
    for (int i = 0; i < argument_count; i++) {
        jstring n_arg = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* n_arg_contents = env->GetStringUTFChars(n_arg, 0);
        c_arguments_size += strlen(n_arg_contents);
        c_arguments_size++; // for '\0'
        env->ReleaseStringUTFChars(n_arg, n_arg_contents);
        env->DeleteLocalRef(n_arg);
    }

    // Stores arguments in contiguous memory.
    char* args_buffer = (char*)calloc(c_arguments_size, sizeof(char));
    if (!args_buffer) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Failed to allocate args_buffer");
        return -1;
    }

    // argv to pass into node.
    char* argv[argument_count];

    // To iterate through the expected start position of each argument in args_buffer.
    char* current_args_position = args_buffer;

    // Populate the args_buffer and argv.
    for (int i = 0; i < argument_count; i++) {
        jstring n_arg = (jstring)env->GetObjectArrayElement(arguments, i);
        const char* current_argument = env->GetStringUTFChars(n_arg, 0);

        // Copy current argument to its expected position in args_buffer.
        strncpy(current_args_position, current_argument, strlen(current_argument));

        // Release the JNI references.
        env->ReleaseStringUTFChars(n_arg, current_argument);
        env->DeleteLocalRef(n_arg);

        // Save current argument start position in argv.
        argv[i] = current_args_position;

        // Increment to the next argument's expected position.
        current_args_position += strlen(current_args_position) + 1;
    }

    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Starting Node.js with %d args, argv[0]=%s", argument_count, argv[0] ? argv[0] : "NULL");

    // Start Node.js in a background thread
    pthread_t thread;
    struct ThreadArgs {
        int argc;
        char** argv;
        char* args_buffer;
    };
    ThreadArgs* thread_args = new ThreadArgs{argument_count, argv, args_buffer};

    int pthread_result = pthread_create(&thread, nullptr, [](void* args) -> void* {
        ThreadArgs* ta = static_cast<ThreadArgs*>(args);
        __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Node.js thread started, calling node::Start...");

        // Call node::Start
        int exit_code = -1;
        try {
            exit_code = node::Start(ta->argc, ta->argv);
        } catch (const std::exception& e) {
            __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "node::Start threw exception: %s", e.what());
            exit_code = -1;
        } catch (...) {
            __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "node::Start threw unknown exception");
            exit_code = -1;
        }

        __android_log_print(ANDROID_LOG_INFO, ADBTAG, "node::Start returned: %d", exit_code);
        g_node_started = false;

        // Notify Java that Node.js has exited
        JNIEnv* env = getJNIEnv();
        if (env && g_nodejs_bundle_obj && g_log_method_id) {
            std::string msg = "Node.js exited with code: " + std::to_string(exit_code);
            jstring jmsg = env->NewStringUTF(msg.c_str());
            env->CallVoidMethod(g_nodejs_bundle_obj, g_log_method_id, jmsg);
            env->DeleteLocalRef(jmsg);
        }

        // Cleanup
        free(ta->args_buffer);
        delete ta;
        return nullptr;
    }, thread_args);

    if (pthread_result != 0) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "pthread_create failed: %s", strerror(pthread_result));
        free(args_buffer);
        delete thread_args;
        return -1;
    }

    pthread_detach(thread);
    g_node_started = true;

    return 0; // Success
}

// Native method: stopNode
extern "C" JNIEXPORT void JNICALL
Java_org_nodejs_mobile_NodeJSBundle_stopNode(
    JNIEnv* env, jobject thiz) {
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "StopNode called");
    g_node_started = false;
}

// Native method: redirectOutputToLogcat
extern "C" JNIEXPORT void JNICALL
Java_org_nodejs_mobile_NodeJSBundle_redirectOutputToLogcat(
    JNIEnv* env, jobject thiz, jboolean enable) {
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "redirectOutputToLogcat: %d", enable);
}

// Native method: check if Node.js is running
extern "C" JNIEXPORT jboolean JNICALL
Java_org_nodejs_mobile_NodeJSBundle_isRunning(
    JNIEnv* env, jobject thiz) {
    return g_node_started ? JNI_TRUE : JNI_FALSE;
}
