#!/usr/bin/env bash

USERNAME="admin"
PASSWORD="testtest"

function get_token {
    PORT=$1
    CSRF_TOKEN=$2
    TOKEN_NAME=$3
    curl "http://localhost:$PORT/createApiToken" \
    -H 'Accept: text/html,application/xhtml+xml' \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H "Origin: http://localhost:$PORT" \
    -H "Referer: http://localhost:$PORT/createApiToken" \
    --data-raw "csrf_token=$CSRF_TOKEN&username=$USERNAME&password=$PASSWORD&new_password=&password_repeat=&token_name=$TOKEN_NAME&token_scope=" \
    --compressed \
    u $USERNAME:$PASSWORD \
    -s
}

get_token "8082" "invalid" "nodered" > get_csrf.html

# get the csrf token, using gnu grep (`brew install grep` on mac os)
CSRF_TOKEN=$(ggrep -oP 'name=.csrf_token. value=\"\K(.*)\"' get_csrf.html)
CSRF_TOKEN2=$(echo $CSRF_TOKEN | rev | cut -c2- | rev) 
echo "CSRF_TOKEN=$CSRF_TOKEN2"

# now really get the token
get_token "8082" "$CSRF_TOKEN2" "nodered" > get_token.html

# <div class="message">New token created:<br /><br /><code>oh.nodered2.c7tg42cr34X2fJVi2QCO1F7R3mmGTuH0xZr5vf2T7AvBfS70ScFT5Iv42z0cEYkTMreesNCI0GtKauJVhLxg</code><br /><br /><small>Please copy it now, it will not be shown again.</small></div>