# For more information about using CMake with Android Studio, read the
# documentation: https://d.android.com/studio/projects/add-native-code.html

# Sets the minimum version of CMake required to build the native library.
cmake_minimum_required(VERSION 3.4.1)

# Creates and names a library, sets it as either STATIC
# or SHARED, and provides the relative paths to its source code.
add_library( # Sets the name of the library.
             nodejs-server-native-lib

             # Sets the library as a shared library.
             SHARED

             # Provides the relative path to your source file(s).
             native-lib.cpp
           )

# Include libnode headers
include_directories(${CMAKE_SOURCE_DIR}/../libnode/include/node/)

# Import prebuilt libnode
add_library( libnode
             SHARED
             IMPORTED )

set_target_properties( # Specifies the target library.
                       libnode

                       # Specifies the parameter you want to define.
                       PROPERTIES IMPORTED_LOCATION

                       # Provides the path to the library you want to import.
                       ${CMAKE_SOURCE_DIR}/../libnode/bin/${ANDROID_ABI}/libnode.so )

# Searches for a specified prebuilt library and stores the path as a
# variable.
find_library( # Sets the name of the path variable.
              log-lib

              # Specifies the name of the NDK library that
              # you want CMake to locate.
              log )

# Specifies libraries CMake should link to your target library.
target_link_libraries( # Specifies the target library.
                       nodejs-server-native-lib

                       libnode

                       # Links the target library to the log library
                       # included in the NDK.
                       ${log-lib} )
