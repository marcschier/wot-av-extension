cmake_minimum_required(VERSION 3.24)
project(windows_capture_sample VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "This sample requires Windows, MSVC and x64.")
endif()

add_library(capture STATIC capture.cpp)
target_compile_features(capture PUBLIC cxx_std_17)
target_compile_definitions(capture PUBLIC
    UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
target_compile_options(capture PUBLIC /W4 /WX /permissive- /EHsc /utf-8)
target_include_directories(capture PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(capture PUBLIC
    mfplat mf mfreadwrite mfuuid ole32 oleaut32 windowscodecs cfgmgr32 bcrypt)

add_executable(windows-capture-worker worker.cpp)
target_link_libraries(windows-capture-worker PRIVATE capture)

add_executable(windows-capture-tests "../../../../tools/tests/adapters/native_tests.cpp")
target_link_libraries(windows-capture-tests PRIVATE capture)
enable_testing()
add_test(NAME memory-and-wic COMMAND windows-capture-tests)
set_tests_properties(memory-and-wic PROPERTIES TIMEOUT 20)
