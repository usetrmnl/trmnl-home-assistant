#!/usr/bin/env bash
# Checks what the add-on's options turn into for the Terminus processes.
#
# Every case asserts on the environment a service actually sees: it runs the
# real init script in the built image, then sources terminus-env.sh the way
# the puma and sidekiq run scripts do. That covers the whole chain rather than
# the shape of the file in the middle of it.
#
# Usage: trmnl-terminus/tests/init-environment.test.sh [image]
set -uo pipefail

IMAGE="${1:-trmnl-terminus:dev}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILED=0

# Prints one variable as the services would see it, or UNSET when the options
# left it alone and Terminus is to apply its own default.
resolve() {
    printf '%s' "$1" > "$WORK/options.json"
    # s6 puts /command on PATH and creates the container environment directory
    # at stage 2; the script's with-contenv shebang needs both to run.
    docker run --rm --entrypoint bash \
        -e PATH=/command:/usr/local/bin:/usr/bin:/bin \
        -e VAR="$2" \
        -v "$WORK/options.json:/data/options.json:ro" \
        "$IMAGE" -c 'set -e
            mkdir -p /run/s6/container_environment
            /etc/cont-init.d/01-init-environment.sh >/dev/null
            source /usr/local/bin/terminus-env.sh
            printf "%s" "${!VAR-UNSET}"'
}

assert_resolves() {
    local name="$1" options="$2" variable="$3" expected="$4" actual
    actual=$(resolve "$options" "$variable")
    if [ "$actual" = "$expected" ]; then
        echo "ok   - $name"
    else
        echo "FAIL - $name"
        echo "       $variable expected: [$expected]"
        echo "       $variable actual:   [$actual]"
        FAILED=1
    fi
}

BASE='"ha_ip":"192.168.1.50"'

assert_resolves "an option left unset keeps Terminus' own default" \
    "{$BASE}" API_ACCESS_TOKEN_PERIOD UNSET

assert_resolves "a set option reaches the services" \
    "{$BASE,\"api_access_token_period\":3600}" API_ACCESS_TOKEN_PERIOD 3600

# jq's // falls through on false as well as null, so a boolean turned off has
# to survive as "false" rather than read as "not set".
assert_resolves "an option turned off survives as false" \
    "{$BASE,\"session_expiration_enabled\":false}" SESSION_EXPIRATION_ENABLED false

# Options are not a way to rewire the container: the vars the add-on manages
# are absent from PASSTHROUGH_OPTIONS, so naming one changes nothing.
assert_resolves "add-on config cannot rewrite the API URI" \
    "{$BASE,\"api_uri\":\"http://elsewhere\"}" API_URI http://192.168.1.50:2300

assert_resolves "add-on config cannot rewrite the database" \
    "{$BASE,\"database_url\":\"postgres://elsewhere\"}" \
    DATABASE_URL postgres://postgres@localhost/terminus

# Written with printf %q and read back by the shell, so anything needing
# quotes has to survive the round trip intact.
assert_resolves "a value containing spaces arrives whole" \
    "{$BASE,\"rack_attack_allowed_subnets\":\"10.0.0.0/8, 192.168.0.0/16\"}" \
    RACK_ATTACK_ALLOWED_SUBNETS "10.0.0.0/8, 192.168.0.0/16"

exit "$FAILED"
