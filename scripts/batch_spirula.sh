#!/usr/bin/env bash
# Run independent short experiments, continuing past a failed scene.
set -euo pipefail
if [[ $# -lt 2 ]]; then
    echo "Usage: $0 SPIRULA_BINARY SCENE_ID [SCENE_ID ...]" >&2
    exit 2
fi
spirula=$1
shift
summary=outputs/spirula-batch.tsv
mkdir -p outputs
process_scene() {
    local scene=$1 stage cfg="configs/scenes/$1.json"
    for stage in download process split inspect; do
        python -m pipeline.reconstruction.run "$stage" --scene "$cfg" --execute || return
    done
    python -m pipeline.reconstruction.prepare_spirula "data/processed/$scene" "data/processed/spirula-$scene" || return
    bash scripts/train_spirula.sh "$spirula" "data/processed/spirula-$scene" "outputs/spirula-$scene" smoke || return
    test -n "$(find "outputs/spirula-$scene/smoke" -type f -name 'splat.ply' -print -quit)"
}
failed=0
for scene in "$@"; do
    if [[ ! "$scene" =~ ^[a-z0-9-]+$ || ! -f "configs/scenes/$scene.json" ]]; then
        printf '%s\tinvalid_scene\n' "$scene" | tee -a "$summary"
        failed=1
        continue
    fi
    available_kib=$(df -Pk . | awk 'NR == 2 {print $4}')
    if [[ "$available_kib" -lt 16777216 ]]; then
        printf '%s\tinsufficient_disk\n' "$scene" | tee -a "$summary"
        exit 1
    fi
    if test -s "outputs/spirula-$scene/smoke/metrics.json" &&
        [[ -n "$(find "outputs/spirula-$scene/smoke" -type f -name 'splat.ply' -print -quit)" ]]; then
        status=already_exported
    elif process_scene "$scene" > "outputs/spirula-$scene-batch.log" 2>&1; then
        status=exported
    else
        status=failed
        failed=1
    fi
    printf '%s\t%s\n' "$scene" "$status" | tee -a "$summary"
done
exit "$failed"
