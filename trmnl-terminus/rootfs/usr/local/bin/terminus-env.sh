#!/bin/bash
export DATABASE_URL="postgres://postgres@localhost/terminus"
export KEYVALUE_URL="unix:///var/run/valkey/valkey.sock"
[ -f /data/.app_secret ] && export APP_SECRET=$(cat /data/.app_secret)
[ -f /data/.api_uri ] && export API_URI=$(cat /data/.api_uri)
