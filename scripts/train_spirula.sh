#!/usr/bin/env bash
# Train one isolated candidate from prepare_spirula.py's dataset.
set -euo pipefail
if [[ $# != 4 || ( "$4" != smoke && "$4" != quality ) ]]; then
    echo "Usage: $0 SPIRULA_BINARY STAGED_DATA RUN_ROOT {smoke|quality}" >&2
    exit 2
fi
spirula=$1
data=$2
root=$3
mode=$4
if [[ -e "$root/$mode" ]]; then
    echo "Run already exists: $root/$mode" >&2
    exit 1
fi
if [[ "$mode" == smoke ]]; then
    settings=(--num-iterations 500 --train-resolution-divisor 2)
else
    settings=(--num-iterations 12000 --train-resolution-divisor 1 --cap-max 2000000 --steps-per-save 2000)
fi
masked=$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["masked"]))' "$data/split-manifest.json")
if [[ "$masked" == 1 ]]; then
    # Teach the renderer to clear background pixels and keep thin mask edges.
    settings+=(--apply-loss-for-mask 1 --mask-boundary-offset 0)
fi
mkdir -p "$root"
"$spirula" train in-the-wild --data "$data" --eval-mode filename \
    --disable-viewer 1 --eval-align 0 --eval-lpips 0 --save-eval-images 1 \
    --output-dir-prefix "$root" --output-dir-name "$mode" "${settings[@]}" \
    2>&1 | tee "$root/$mode.log"
