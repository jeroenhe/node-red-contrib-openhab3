#!/usr/bin/env bash

# Run this to release a patch version. Make sure the README.md is already upgraded
# ToDo: test the new version in available from the README.md, ensuring
# the change was documented.

# Make sure the actual changes have been committed
release-it --only-version
