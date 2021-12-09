#!/usr/bin/env bash

# Run this to release a patch version. Make sure the README.md is already upgraded
# ToDo: test the new version in available from the README.md, ensuring
# the change was documented.

# Howto release a change to NPM:
# 1. Make sure changes end up on the main branch on the server. Include an
#    update to README.md as well.
# 2. Run this script and choose the release # the same as done in README.md

release-it --only-version $@
