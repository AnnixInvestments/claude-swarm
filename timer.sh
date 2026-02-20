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

timed_step() {
  local name="$1"
  shift
  local start=$SECONDS
  local exit_code=0

  echo ""
  echo ">> ${name}..."

  "$@" || exit_code=$?

  local elapsed=$((SECONDS - start))

  if [ "$exit_code" -ne 0 ]; then
    TIMED_STEPS+=("${name}|${elapsed}|failed")
    print_timing_summary
    exit "$exit_code"
  else
    TIMED_STEPS+=("${name}|${elapsed}|ok")
  fi
}

print_timing_summary() {
  local max_secs=0
  local max_name=""
  local total=0

  for entry in "${TIMED_STEPS[@]}"; do
    local secs="${entry#*|}"
    secs="${secs%|*}"
    total=$((total + secs))
    if [ "$secs" -gt "$max_secs" ]; then
      max_secs=$secs
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
    local secs="${rest%%|*}"
    local status="${rest##*|}"
    local mins=$((secs / 60))
    local rem=$((secs % 60))
    local suffix=""

    if [ "$status" = "failed" ]; then
      suffix="  <- FAILED"
    elif [ "$name" = "$max_name" ] && [ "${#TIMED_STEPS[@]}" -gt 1 ]; then
      suffix="  <- slowest"
    fi

    printf "  %-32s %dm %02ds%s\n" "$name" "$mins" "$rem" "$suffix"
  done

  echo "$sep"
  local total_mins=$((total / 60))
  local total_rem=$((total % 60))
  printf "  %-32s %dm %02ds\n" "TOTAL" "$total_mins" "$total_rem"
  echo ""
}
