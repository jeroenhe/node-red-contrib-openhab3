#!/usr/bin/env bash

# Run this to release a patch version. Make sure the README.md is already upgraded
# ToDo: test the new version in available from the README.md, ensuring
# the change was documented.

# Test for any changes with regards to linting. If so, abort the release.
npm run lint
EXIT_CODE=$?
if [ "${EXIT_CODE}" != "0" ]; then
    echo "npm run lint returned errors. Try run \"npm run lint-fix\" and commit changes to git before re-running this script."
    exit $EXIT_CODE
fi

# Howto release a change to NPM:
# 1. Make sure changes end up on the main branch on the server. Include an
#    update to README.md as well.
# 2. Run this script and choose the release # the same as done in README.md. Also add an otp token to authorized releasing it:
# --npm.otp=000000

release-it --only-version "$@"
