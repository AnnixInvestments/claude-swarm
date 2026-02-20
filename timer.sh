#!/usr/bin/env bash
# Per-step timing utility for pre-push hooks.
# Source this file, wrap each step with timed_step, then call print_timing_summary.
#
# Usage:
#   source "${ROOT_DIR}/node_modules/@annix/claude-swarm/timer.sh"
#
#   timed_step "step name" some_command --args
#   timed_step "other step" shell_function_name
#
#   print_timing_summary

TIMED_STEPS=()

_timer_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  else
    python3 -c "import time; print(int(time.time()*1000))"
  fi
}

_format_ms() {
  local ms="$1"
  local total_s=$((ms / 1000))
  local frac=$(( (ms % 1000) / 100 ))
  local mins=$((total_s / 60))
  local secs=$((total_s % 60))

  if [ "$mins" -gt 0 ]; then
    printf "%dm %02d.%ds" "$mins" "$secs" "$frac"
  else
    printf "%2d.%ds" "$secs" "$frac"
  fi
}

timed_step() {
  local name="$1"
  shift
  local start
  start=$(_timer_ms)
  local exit_code=0

  echo ""
  echo ">> ${name}..."

  "$@" || exit_code=$?

  local end
  end=$(_timer_ms)
  local elapsed=$((end - start))

  if [ "$exit_code" -ne 0 ]; then
    TIMED_STEPS+=("${name}|${elapsed}|failed")
    print_timing_summary
    exit "$exit_code"
  else
    TIMED_STEPS+=("${name}|${elapsed}|ok")
  fi
}

print_timing_summary() {
  local max_ms=0
  local max_name=""
  local total=0

  for entry in "${TIMED_STEPS[@]}"; do
    local ms="${entry#*|}"
    ms="${ms%|*}"
    total=$((total + ms))
    if [ "$ms" -gt "$max_ms" ]; then
      max_ms=$ms
      max_name="${entry%%|*}"
    fi
  done

  local sep="--------------------------------------------"
  echo ""
  echo "Pre-push step timings"
  echo "$sep"

  for entry in "${TIMED_STEPS[@]}"; do
    local name="${entry%%|*}"
    local rest="${entry#*|}"
    local ms="${rest%%|*}"
    local status="${rest##*|}"
    local suffix=""

    if [ "$status" = "failed" ]; then
      suffix="  <- FAILED"
    elif [ "$name" = "$max_name" ] && [ "${#TIMED_STEPS[@]}" -gt 1 ]; then
      suffix="  <- slowest"
    fi

    local formatted
    formatted=$(_format_ms "$ms")
    printf "  %-32s %8s%s\n" "$name" "$formatted" "$suffix"
  done

  echo "$sep"
  local total_formatted
  total_formatted=$(_format_ms "$total")
  printf "  %-32s %8s\n" "TOTAL" "$total_formatted"
  echo ""
}
