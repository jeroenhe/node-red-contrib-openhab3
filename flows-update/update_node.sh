#!/usr/bin/env bash

RESULT_FILE="/tmp/result.txt"
FILE_WITH_CSRF="/tmp/output.html"
COOKIES_FILE="/tmp/cookies.txt"
MODULE_NAME="node-red-contrib-openhab3"
FLOWS_URL="https://flows.nodered.org/add/node"

# remove any previous cookies
if [ -f "${COOKIES_FILE}" ]; then
    rm "${COOKIES_FILE}"
fi

# get the _csrf token
curl -s \
    -c "${COOKIES_FILE}" \
    -b "${COOKIES_FILE}" \
    -XGET "${FLOWS_URL}" > ${FILE_WITH_CSRF}

input=$(cat ${FILE_WITH_CSRF})
CSRF_TOKEN=$(echo "${input}" | ./get_token.py)

if [[ ! -z "${CSRF_TOKEN}" ]]; then
    echo "_csrf token was found to be $TOKEN"
else
    echo "_csrf token not found in HTML!"
    exit 1
fi

# Send a node update request, with the _csrf token
curl -s \
    -XPOST "${FLOWS_URL}" \
    -c "${COOKIES_FILE}" \
    -b "${COOKIES_FILE}" \
    -H "referer: ${FLOWS_URL}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "x-requested-with: XMLHttpRequest" \
    -d "module=${MODULE_NAME}&_csrf=$CSRF_TOKEN" > ${RESULT_FILE}

# Show the add/node page' response
RESULT=$(cat ${RESULT_FILE})

if [[ "${RESULT}" =~ "updated" ]]; then
    echo "Module was updated successfully: '$RESULT'"
    exit 0
else
    echo "Module was NOT updated successfully: '$RESULT'"
    exit 1
fi
