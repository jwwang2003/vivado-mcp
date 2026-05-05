set script_dir [file dirname [file normalize [info script]]]
set repo_root [file normalize [file join $script_dir ".." ".."]]
# MachSuite benchmark: 3rdParty/MachSuite/aes/aes
set aes_dir [file join $repo_root "3rdParty" "MachSuite" "aes" "aes"]
set common_dir [file join $repo_root "3rdParty" "MachSuite" "common"]
set work_dir [file normalize [file join $script_dir "work" "machsuite_aes_hls"]]

if {[info exists ::env(VIVADO_MCP_HLS_WORK_DIR)] && $::env(VIVADO_MCP_HLS_WORK_DIR) ne ""} {
    set requested_work_dir $::env(VIVADO_MCP_HLS_WORK_DIR)
} elseif {[llength $argv] > 0} {
    set requested_work_dir [lindex $argv 0]
}

if {[info exists requested_work_dir]} {
    if {[file pathtype $requested_work_dir] eq "relative"} {
        set work_dir [file normalize [file join $repo_root $requested_work_dir]]
    } else {
        set work_dir [file normalize $requested_work_dir]
    }
}

set part "xc7vx690tffg1157-2"
set clock_period 10

file mkdir $work_dir
cd $work_dir

open_project -reset machsuite_aes
set_top aes256_encrypt_ecb
add_files [file join $aes_dir "aes.c"] -cflags "-I$common_dir"

open_solution -reset solution1
set_part $part
create_clock -period $clock_period -name default
csynth_design

exit
