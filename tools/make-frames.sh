#!/usr/bin/env bash
# Pull 6 frames from a video file into frames/<category>/<slug>/1..6.jpg
# Frame 1 is the hardest (early, obscure) and frame 6 the easiest (late, iconic)
# unless you pass your own timestamps.
#
# Usage:
#   tools/make-frames.sh movies "The Matrix" ~/Videos/matrix.mkv
#   tools/make-frames.sh shows "Breaking Bad" ep.mp4 00:03:10 00:12:44 00:20:01 00:31:00 00:40:12 00:44:30
#
# Requires ffmpeg and ffprobe.
set -euo pipefail

cat="${1:?category: movies|shows|games}"
title="${2:?title exactly as in data/puzzles.json}"
video="${3:?path to video file}"
shift 3

slug=$(printf '%s' "$title" | iconv -f utf-8 -t ascii//TRANSLIT 2>/dev/null | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/&/and/g' -e 's/[^a-z0-9]\+/-/g' -e 's/^-//' -e 's/-$//')
out="$(dirname "$0")/../frames/$cat/$slug"
mkdir -p "$out"

if [ "$#" -eq 6 ]; then
  stamps=("$@")
else
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
  # Spread across 10%–85% of the runtime.
  stamps=()
  for f in 0.10 0.25 0.40 0.55 0.70 0.85; do
    stamps+=("$(awk -v d="$dur" -v f="$f" 'BEGIN{printf "%.2f", d*f}')")
  done
fi

i=1
for t in "${stamps[@]}"; do
  ffmpeg -loglevel error -y -ss "$t" -i "$video" -frames:v 1 \
    -vf "scale='min(1280,iw)':-2" -q:v 4 "$out/$i.jpg"
  echo "frame $i @ $t -> $out/$i.jpg"
  i=$((i + 1))
done
