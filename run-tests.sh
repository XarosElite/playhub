#!/usr/bin/env bash
# Runs every PlayHub test suite in Docker. Usage:
#   ./run-tests.sh              all suites
#   ./run-tests.sh api worker   just those
#   RUN_DOCKER_TESTS=1 ./run-tests.sh worker   include tests against the real Docker daemon
set -uo pipefail
cd "$(dirname "$0")"

suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=(api worker frontend e2e)

declare -A service=([api]=api-tests [worker]=worker-tests [frontend]=frontend-tests [e2e]=frontend-e2e)
compose=(docker compose -f docker-compose.test.yml)
failed=()

for suite in "${suites[@]}"; do
  name=${service[$suite]:-}
  if [ -z "$name" ]; then echo "Unknown suite '$suite' (api, worker, frontend, e2e)"; exit 2; fi
  echo "=== $suite ==="
  "${compose[@]}" build "$name" && "${compose[@]}" run --rm "$name" || failed+=("$suite")
done

"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All suites passed: ${suites[*]}"
