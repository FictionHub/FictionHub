/*
  Node.js for FictionHub - JNI layer
  Provides native methods for org.nodejs.mobile.NodeJSBundle
*/

#include <jni.h>
#include <string>
#include <cstdlib>
#include <android/log.h>
#include <pthread.h>

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
    JNIEnv* env,
    jobject thiz,
    jobjectArray arguments) {

    // Cache the Java object for callbacks
    g_nodejs_bundle_obj = env->NewGlobalRef(thiz);
    
    // Get the log method ID
    jclass cls = env->GetObjectClass(thiz);
    g_log_method_id = env->GetMethodID(cls, "logFromNative", "(Ljava/lang/String;)V");
    env->DeleteLocalRef(cls);

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

    // Start Node.js in a background thread
    pthread_t thread;
    struct ThreadArgs {
        int argc;
        char** argv;
    };
    ThreadArgs* thread_args = new ThreadArgs{argument_count, argv};
    
    pthread_create(&thread, nullptr, [](void* args) -> void* {
        ThreadArgs* ta = static_cast<ThreadArgs*>(args);
        const int exit_code = node::Start(ta->argc, ta->argv);
        
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
    JNIEnv* env,
    jobject thiz) {
    // Node.js doesn't have a clean shutdown API, but we can try to terminate
    // For now, just log
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "StopNode called - Node.js doesn't support clean shutdown");
}

// Native method: redirectOutputToLogcat
extern "C" JNIEXPORT void JNICALL
Java_org_nodejs_mobile_NodeJSBundle_redirectOutputToLogcat(
    JNIEnv* env,
    jobject thiz,
    jboolean enable) {
    // This would require redirecting stdout/stderr in Node.js
    // For now, just log
    __android_log_print(ANDROID_LOG_INFO, ADBTAG, "redirectOutputToLogcat: %d", enable);
}
