#!/bin/bash
task_script_root="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$task_script_root/scripts/build-mac.sh"
echo 'Press Enter to close.'
read -r
