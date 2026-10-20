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

#include "node.h"

const char *ADBTAG = "FICTIONHUB-NODEJS";

// Cache JNIEnv for callback from Node.js
static JavaVM* g_jvm = nullptr;
static jobject g_nodejs_bundle_obj = nullptr;
static jmethodID g_log_method_id = nullptr;

extern "C" JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void* reserved) {
    g_jvm = vm;
    return JNI_VERSION_1_6;
}

// Helper to get JNIEnv for current thread
static JNIEnv* getJNIEnv() {
    JNIEnv* env = nullptr;
    if (g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
            return nullptr;
        }
    }
    return env;
}

// Native method: startNodeWithArguments
extern "C" JNIEXPORT jint JNICALL
Java_org_nodejs_mobile_NodeJSBundle_startNodeWithArguments(
    JNIEnv* env, jobject thiz, jobjectArray arguments) {

    // Cache the Java object for callbacks
    g_nodejs_bundle_obj = env->NewGlobalRef(thiz);

    // Get the log method ID
    jclass cls = env->GetObjectClass(thiz);
    g_log_method_id = env->GetMethodID(cls, "logFromNative", "(Ljava/lang/String;)V");
    env->DeleteLocalRef(cls);

    // Get filesDir from Java context
    cls = env->GetObjectClass(thiz);
    jmethodID getFilesDirId = env->GetMethodID(cls, "getFilesDir", "()Ljava/io/File;");
    jobject filesDirObj = env->CallObjectMethod(thiz, getFilesDirId);
    jclass fileClass = env->GetObjectClass(filesDirObj);
    jmethodID getAbsolutePathId = env->GetMethodID(fileClass, "getAbsolutePath", "()Ljava/lang/String;");
    jstring filesDirPath = (jstring)env->CallObjectMethod(filesDirObj, getAbsolutePathId);
    const char* nativeFilesDir = env->GetStringUTFChars(filesDirPath, 0);

    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Files dir: %s", nativeFilesDir);

    // Build server directory path
    std::string serverDir = std::string(nativeFilesDir) + "/server";

    // Ensure server directory exists
    struct stat st;
    if (stat(serverDir.c_str(), &st) != 0) {
        __android_log_print(ANDROID_LOG_ERROR, ADBTAG, "Server dir does not exist: %s", serverDir.c_str());
        env->ReleaseStringUTFChars(filesDirPath, nativeFilesDir);
        return -1;
    }

    // Get external files dir for video/manga (passed from Java via System.setProperty, but we set here too)
    // We'll set these in the native process

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

    // Set PORT
    setenv("PORT", "8787", 1);

    // Set video and manga dirs
    std::string videoDir = std::string(nativeFilesDir) + "/FictionHub/Video Downloads";
    std::string mangaDir = std::string(nativeFilesDir) + "/FictionHub/Manga Downloads";
    setenv("FH_VIDEO_DIR", videoDir.c_str(), 1);
    setenv("FH_MANGA_DIR", mangaDir.c_str(), 1);

    // Ensure directories exist
    mkdir(videoDir.c_str(), 0755);
    mkdir(mangaDir.c_str(), 0755);

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

    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Starting Node.js with %d args", argument_count);

    // Start Node.js in a background thread
    pthread_t thread;
    struct ThreadArgs {
        int argc;
        char** argv;
    };
    ThreadArgs* thread_args = new ThreadArgs{argument_count, argv};

    pthread_create(&thread, nullptr, [](void* args) -> void* {
        ThreadArgs* ta = static_cast<ThreadArgs*>(args);
        __android_log_print(ANDROID_LOG_INFO, ADBTAG, "Calling node::Start...");

        const int exit_code = node::Start(ta->argc, ta->argv);

        __android_log_print(ANDROID_LOG_INFO, ADBTAG, "node::Start returned: %d", exit_code);

        // Notify Java that Node.js has exited
        JNIEnv* env = getJNIEnv();
        if (env && g_nodejs_bundle_obj && g_log_method_id) {
            std::string msg = "Node.js exited with code: " + std::to_string(exit_code);
            jstring jmsg = env->NewStringUTF(msg.c_str());
            env->CallVoidMethod(g_nodejs_bundle_obj, g_log_method_id, jmsg);
            env->DeleteLocalRef(jmsg);
        }

        // Cleanup
        free(ta->argv[0]); // args_buffer
        delete ta;
        return nullptr;
    }, thread_args);

    pthread_detach(thread);

    return 0; // Success
}

// Native method: stopNode
extern "C" JNIEXPORT void JNICALL
Java_org_nodejs_mobile_NodeJSBundle_stopNode(
    JNIEnv* env, jobject thiz) {
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "StopNode called - Node.js doesn't support clean shutdown");
}

// Native method: redirectOutputToLogcat
extern "C" JNIEXPORT void JNICALL
Java_org_nodejs_mobile_NodeJSBundle_redirectOutputToLogcat(
    JNIEnv* env, jobject thiz, jboolean enable) {
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "redirectOutputToLogcat: %d", enable);
}
