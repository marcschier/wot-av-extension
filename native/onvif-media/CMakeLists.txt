cmake_minimum_required(VERSION 3.28)
project(onvif_native_media VERSION 0.2.0 LANGUAGES C)

if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "P0 is qualified only for Windows MSVC x64; no other target is implied.")
endif()
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreadedDLL)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

set(P0_GSTREAMER_ROOT "" CACHE PATH "Explicit GStreamer 1.28.7 MSVC x64 SDK root")
set(P0_UPSTREAM_ROOT "" CACHE PATH "Pristine pinned RTSP sources from tools/fetch-sources.py")
set(P0_NODE_EXECUTABLE "node" CACHE FILEPATH "Existing Node >=22 executable for explicit IPC smoke tests")
if(NOT EXISTS "${P0_GSTREAMER_ROOT}/include/gstreamer-1.0/gst/gst.h")
    message(FATAL_ERROR
        "Missing GStreamer SDK. Supply P0_GSTREAMER_ROOT. Explicit local fetch: "
        "native\\onvif-media\\tools\\fetch-sdk.ps1 -AcceptUpstreamLicenses -ProvisionPortable")
endif()
file(READ "${P0_GSTREAMER_ROOT}/include/gstreamer-1.0/gst/gstversion.h" gst_version_header)
foreach(component IN ITEMS MAJOR MINOR MICRO)
    if(component STREQUAL "MAJOR")
        set(expected 1)
    elseif(component STREQUAL "MINOR")
        set(expected 28)
    else()
        set(expected 7)
    endif()
    if(NOT gst_version_header MATCHES "#define GST_VERSION_${component} \\(${expected}\\)")
        message(FATAL_ERROR "GStreamer headers must be exactly 1.28.7, not merely ABI-compatible.")
    endif()
endforeach()
find_package(Python3 3.11 REQUIRED COMPONENTS Interpreter)

add_library(p0_sdk INTERFACE)
target_include_directories(p0_sdk INTERFACE
    "${P0_GSTREAMER_ROOT}/include/gstreamer-1.0"
    "${P0_GSTREAMER_ROOT}/include/glib-2.0"
    "${P0_GSTREAMER_ROOT}/lib/glib-2.0/include"
    "${P0_GSTREAMER_ROOT}/include")
foreach(name IN ITEMS gstreamer-1.0 gstbase-1.0 gstapp-1.0 gstrtp-1.0
        gstsdp-1.0 gstnet-1.0 gstvideo-1.0 gstaudio-1.0 gio-2.0 gobject-2.0 glib-2.0)
    unset(sdk_${name} CACHE)
    find_library(sdk_${name} NAMES "${name}" PATHS "${P0_GSTREAMER_ROOT}/lib"
        NO_DEFAULT_PATH NO_CACHE REQUIRED)
    target_link_libraries(p0_sdk INTERFACE "${sdk_${name}}")
endforeach()
unset(p0_xml2 CACHE)
find_library(p0_xml2 NAMES xml2 PATHS "${P0_GSTREAMER_ROOT}/lib" NO_DEFAULT_PATH NO_CACHE REQUIRED)
add_library(p0_metadata STATIC test/p0_metadata.c)
target_include_directories(p0_metadata PUBLIC test "${P0_GSTREAMER_ROOT}/include/libxml2")
target_link_libraries(p0_metadata PUBLIC p0_sdk "${p0_xml2}")
target_compile_options(p0_metadata PRIVATE /W4 /WX /utf-8)

configure_file(cmake/config.h.in config.h @ONLY)
execute_process(
    COMMAND "${Python3_EXECUTABLE}" -B "${CMAKE_CURRENT_SOURCE_DIR}/tools/prepare-source.py"
        --source "${P0_UPSTREAM_ROOT}" --build "${CMAKE_BINARY_DIR}"
    COMMAND_ERROR_IS_FATAL ANY)
set(rtsp "${CMAKE_BINARY_DIR}/upstream/subprojects/gst-plugins-base/gst-libs/gst/rtsp")
set(plugin "${CMAKE_BINARY_DIR}/upstream/subprojects/gst-plugins-good/gst/rtsp")

add_library(p0_digest STATIC patches/p0_digest.c)
target_include_directories(p0_digest PUBLIC patches)
target_link_libraries(p0_digest PUBLIC p0_sdk bcrypt)
target_compile_options(p0_digest PRIVATE /W4 /WX /utf-8)

set(enum_source "${CMAKE_BINARY_DIR}/gstrtsp-enumtypes.c")
add_custom_command(OUTPUT "${enum_source}"
    COMMAND "${Python3_EXECUTABLE}" "${P0_GSTREAMER_ROOT}/bin/glib-mkenums"
        --template "${CMAKE_CURRENT_SOURCE_DIR}/cmake/rtsp-enumtypes.c.in"
        --output "${enum_source}" "${rtsp}/gstrtspdefs.h" "${rtsp}/gstrtspmessage.h"
        "${rtsp}/gstrtsprange.h" "${rtsp}/gstrtsptransport.h"
    DEPENDS cmake/rtsp-enumtypes.c.in
    VERBATIM)
add_library(p0_rtsp SHARED
    "${rtsp}/gstrtsptransport.c" "${rtsp}/gstrtspurl.c"
    "${rtsp}/gstrtspmessage.c" "${rtsp}/gstrtspconnection.c"
    "${rtsp}/gstrtspdefs.c" "${rtsp}/gstrtspextension.c"
    "${rtsp}/gstrtsprange.c" "${enum_source}")
target_include_directories(p0_rtsp PRIVATE "${CMAKE_BINARY_DIR}" "${rtsp}"
    "${P0_GSTREAMER_ROOT}/include/gstreamer-1.0/gst/rtsp")
target_compile_definitions(p0_rtsp PRIVATE HAVE_CONFIG_H BUILDING_GST_RTSP
    _CRT_SECURE_NO_WARNINGS G_LOG_DOMAIN="GStreamer-RTSP")
target_link_libraries(p0_rtsp PRIVATE p0_digest ws2_32)
set_target_properties(p0_rtsp PROPERTIES OUTPUT_NAME "gstrtsp-1.0-0")

add_library(p0_rtsp_plugin MODULE
    "${plugin}/gstrtspelement.c" "${plugin}/gstrtsp.c"
    "${plugin}/gstrtspsrc.c" "${plugin}/gstrtpdec.c" "${plugin}/gstrtspext.c")
target_include_directories(p0_rtsp_plugin PRIVATE "${CMAKE_BINARY_DIR}" "${plugin}"
    "${CMAKE_BINARY_DIR}/upstream/subprojects/gstreamer")
target_compile_definitions(p0_rtsp_plugin PRIVATE HAVE_CONFIG_H _CRT_SECURE_NO_WARNINGS)
target_link_libraries(p0_rtsp_plugin PRIVATE p0_rtsp p0_digest)
set_target_properties(p0_rtsp_plugin PROPERTIES OUTPUT_NAME gstrtsp
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/plugins")
foreach(name IN ITEMS gstcoreelements gstapp gstrtp gstrtpmanager gstjpeg gstmulaw
        gsttypefindfunctions gstvideoconvertscale gstaudioconvert gstudp
        gstaudioparsers gstvideoparsersbad gstlibav)
    configure_file("${P0_GSTREAMER_ROOT}/lib/gstreamer-1.0/${name}.dll"
        "${CMAKE_BINARY_DIR}/plugins/${name}.dll" COPYONLY)
endforeach()
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/gio")
configure_file("${P0_GSTREAMER_ROOT}/lib/gio/modules/gioopenssl.dll"
    "${CMAKE_BINARY_DIR}/gio/gioopenssl.dll" COPYONLY)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/patches/classic-rtsp-p0.patch" patch_hash)
add_library(media_metadata STATIC src/metadata.c)
target_include_directories(media_metadata PUBLIC src "${P0_GSTREAMER_ROOT}/include/libxml2")
target_link_libraries(media_metadata PUBLIC p0_sdk "${p0_xml2}")
target_compile_options(media_metadata PRIVATE /W4 /WX /utf-8)
add_library(media_jpeg STATIC src/jpeg.c)
target_include_directories(media_jpeg PUBLIC src)
target_link_libraries(media_jpeg PUBLIC p0_sdk)
target_compile_options(media_jpeg PRIVATE /W4 /WX /utf-8)
add_library(media_terminal STATIC src/terminal.c)
target_include_directories(media_terminal PUBLIC src)
target_link_libraries(media_terminal PUBLIC media_metadata)
target_compile_options(media_terminal PRIVATE /W4 /WX /utf-8)
add_executable(onvif_media_worker src/worker.c src/ipc.c src/options.c)
target_include_directories(onvif_media_worker PRIVATE patches)
target_link_libraries(onvif_media_worker PRIVATE p0_rtsp p0_digest media_metadata media_jpeg media_terminal)
target_compile_definitions(onvif_media_worker PRIVATE P0_PATCH_SHA256="${patch_hash}")
target_compile_options(onvif_media_worker PRIVATE /W4 /WX /utf-8)
add_dependencies(onvif_media_worker p0_rtsp_plugin)

include(CTest)
if(BUILD_TESTING)
    add_executable(p0_fixture_worker test/p0_worker.c test/p0_ipc.c)
    target_link_libraries(p0_fixture_worker PRIVATE p0_rtsp p0_metadata)
    target_compile_definitions(p0_fixture_worker PRIVATE P0_PATCH_SHA256="${patch_hash}")
    target_compile_options(p0_fixture_worker PRIVATE /W4 /WX /utf-8)
    add_dependencies(p0_fixture_worker p0_rtsp_plugin)
    add_executable(p0_digest_test test/test_digest.c)
    target_link_libraries(p0_digest_test PRIVATE p0_digest p0_rtsp)
    target_compile_options(p0_digest_test PRIVATE /W4 /WX /utf-8)
    add_test(NAME p0.digest COMMAND p0_digest_test)
    set_tests_properties(p0.digest PROPERTIES
        ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${P0_GSTREAMER_ROOT}/bin"
        TIMEOUT 15)
    add_executable(p0_metadata_test test/test_metadata.c)
    target_link_libraries(p0_metadata_test PRIVATE p0_metadata)
    target_compile_options(p0_metadata_test PRIVATE /W4 /WX /utf-8)
    add_test(NAME p0.metadata COMMAND p0_metadata_test)
    set_tests_properties(p0.metadata PROPERTIES
        ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${P0_GSTREAMER_ROOT}/bin"
        ENVIRONMENT "GST_PLUGIN_SYSTEM_PATH_1_0=${CMAKE_BINARY_DIR}/plugins;GST_PLUGIN_PATH_1_0=;GST_REGISTRY_1_0=${CMAKE_BINARY_DIR}/test-registry.bin;GST_REGISTRY_FORK=no"
        TIMEOUT 15)
    add_test(NAME p0.loopback
        COMMAND "${Python3_EXECUTABLE}" -B "${CMAKE_CURRENT_SOURCE_DIR}/test/gate.py"
            --worker "$<TARGET_FILE:p0_fixture_worker>" --sdk-root "${P0_GSTREAMER_ROOT}"
            --node-executable "${P0_NODE_EXECUTABLE}"
            --case all --report "${CMAKE_BINARY_DIR}/qualification.json")
    set_tests_properties(p0.loopback PROPERTIES TIMEOUT 120 RUN_SERIAL TRUE)
    add_executable(media_metadata_test test/test_metadata_v2.c)
    target_link_libraries(media_metadata_test PRIVATE media_metadata)
    target_compile_options(media_metadata_test PRIVATE /W4 /WX /utf-8)
    add_test(NAME media.metadata COMMAND media_metadata_test)
    set_tests_properties(media.metadata PROPERTIES
        ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${P0_GSTREAMER_ROOT}/bin"
        TIMEOUT 15)
    add_executable(media_jpeg_test test/test_jpeg.c)
    target_link_libraries(media_jpeg_test PRIVATE media_jpeg)
    target_compile_options(media_jpeg_test PRIVATE /W4 /WX /utf-8)
    add_test(NAME media.jpeg COMMAND media_jpeg_test)
    set_tests_properties(media.jpeg PROPERTIES
        ENVIRONMENT_MODIFICATION "PATH=path_list_prepend:${P0_GSTREAMER_ROOT}/bin"
        TIMEOUT 15)
    add_test(NAME media.loopback
        COMMAND "${Python3_EXECUTABLE}" -B "${CMAKE_CURRENT_SOURCE_DIR}/test/runtime_gate.py"
            --worker "$<TARGET_FILE:onvif_media_worker>" --sdk-root "${P0_GSTREAMER_ROOT}"
            --node-executable "${P0_NODE_EXECUTABLE}"
            --case all --report "${CMAKE_BINARY_DIR}/runtime-qualification.json")
    set_tests_properties(media.loopback PROPERTIES TIMEOUT 300 RUN_SERIAL TRUE)
    add_test(NAME media.codecs
        COMMAND "${Python3_EXECUTABLE}" -B "${CMAKE_CURRENT_SOURCE_DIR}/test/codec_gate.py"
            --worker "$<TARGET_FILE:onvif_media_worker>" --sdk-root "${P0_GSTREAMER_ROOT}"
            --case all --report "${CMAKE_BINARY_DIR}/codec-qualification.json")
    set_tests_properties(media.codecs PROPERTIES TIMEOUT 180 RUN_SERIAL TRUE)
    foreach(test_name IN ITEMS p0.digest p0.metadata media.metadata media.jpeg)
        set_tests_properties(${test_name} PROPERTIES ENVIRONMENT
            "GST_PLUGIN_SYSTEM_PATH_1_0=${CMAKE_BINARY_DIR}/plugins;GST_PLUGIN_PATH_1_0=;GST_REGISTRY_1_0=${CMAKE_BINARY_DIR}/unit-test-registry.bin;GST_REGISTRY_FORK=no;GIO_MODULE_DIR=${CMAKE_BINARY_DIR}/gio;GIO_EXTRA_MODULES=;GIO_USE_PROXY_RESOLVER=dummy")
    endforeach()
endif()
