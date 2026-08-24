#!/usr/bin/env sh
# Runs the compiled test suite.
#
# Why not `node --test "dist/**/*.test.js"` or `node --test dist/`:
#   - the glob form has differed across supported Node releases and can be
#     interpreted literally — it fails with
#     "Could not find 'dist/**/*.test.js'";
#   - the directory form resolves dist/ as a *package*, because the build
#     copies package.json into dist/ for the Lambda bundle, so Node follows
#     its "main" entry instead of scanning for test files.
# An explicit file list avoids both. The guard means an empty result fails
# loudly rather than reporting a green run that tested nothing.
set -eu

count=$(find dist -path 'dist/node_modules' -prune -o -name '*.test.js' -print | wc -l | tr -d ' ')

if [ "$count" -eq 0 ]; then
  echo "error: no compiled test files found under dist/ — did the build run?" >&2
  exit 1
fi

echo "Running $count compiled test file(s)."
# -exec ... {} + batches every file into one node invocation and is POSIX, so
# it works with BSD find on macOS as well as GNU find on CI.
exec find dist -path 'dist/node_modules' -prune -o -name '*.test.js' -exec node --test {} +
