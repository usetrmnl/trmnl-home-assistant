---
name: haos-test-vm
description: Test an app from this repo (TRMNL HA, Terminus, LaraPaper) on a real Home Assistant OS install in a virtual machine — set one up, install a release or a branch, and prove ingress, ports, options and updates. Use when a change touches what unit tests and the mock HA cannot show (Supervisor, ingress, the sidebar, port 10000, app options, store install or update), or when asked to "test on real Home Assistant" or "test on HA OS".
---

# Test on a real Home Assistant OS

Unit tests and `bun run mock:server` stop at Supervisor. Ingress, the sidebar, port mappings,
app options and store updates only exist on a real Home Assistant OS. Run one in a VM.

## 1. Get a VM

If a test VM exists already, use it: start it and go to step 2. A new one takes about 30 minutes.

1. Download the image from https://github.com/home-assistant/operating-system/releases.
   Check the asset list: some releases ship for one board only. Use `generic-aarch64` on Apple
   Silicon, `ova` or `generic-x86-64` elsewhere. Unpack the `.xz` file.
2. Boot it with EFI, at least 4 GB of memory and 2 CPUs:
   - **VirtualBox**: the `.vdi`, EFI on, bridged network. The VM gets its own address on the LAN.
   - **QEMU** (`brew install qemu`, Apple Silicon): the `.qcow2` file with
     `qemu-system-aarch64 -machine virt,highmem=on -accel hvf -cpu host -smp 4 -m 4096 -bios /opt/homebrew/share/qemu/edk2-aarch64-code.fd -drive if=virtio,file=haos.qcow2 -device virtio-net-pci,netdev=n0 -netdev user,id=n0,hostfwd=tcp::18080-:80,hostfwd=tcp::11000-:10000,hostfwd=tcp::12222-:22 -display none -serial file:serial.log`.
     Add one `hostfwd` for each port you test.
3. **Home Assistant Core serves on port 80**, not 8123, on new installs (HA OS 18.4, Core 2026.11).
   Port 8123 answers with a 307 to port 80 and drops the port, so through a port forward it looks
   like a redirect loop. Forward guest port 80.
4. First boot downloads Core: wait until `GET /api/onboarding` answers 200 (5 to 20 minutes).
5. Onboard with the API: `POST /api/onboarding/users` with `client_id` (the HA URL plus `/`),
   `name`, `username`, `password` and `language` returns an `auth_code`. Exchange it at
   `POST /auth/token` (`grant_type=authorization_code`). Then POST `{}` to
   `/api/onboarding/core_config` and `/api/onboarding/analytics` with the token, and
   `{client_id, redirect_uri}` to `/api/onboarding/integration`.

## 2. Drive Supervisor

`scripts/supervisor.ts` calls the Supervisor API through HA's websocket, as the frontend does:

```bash
export HA_URL=http://<vm> HA_USER=<owner> HA_PASSWORD=<password>   # or HA_TOKEN=<token>
bun .claude/skills/haos-test-vm/scripts/supervisor.ts post /store/repositories '{"repository":"https://github.com/usetrmnl/trmnl-home-assistant"}'
bun .claude/skills/haos-test-vm/scripts/supervisor.ts post /store/addons/0b3326fa_trmnl-ha/install
bun .claude/skills/haos-test-vm/scripts/supervisor.ts post /addons/0b3326fa_trmnl-ha/start
bun .claude/skills/haos-test-vm/scripts/supervisor.ts get /addons/0b3326fa_trmnl-ha/info
```

- Apps from this repository's store have the slug `0b3326fa_<slug>` and the hostname
  `0b3326fa-<slug>` on the Supervisor network.
- Run `post /store/reload` before you install or update. Until then, the store shows a cached
  version list.
- Options: `post /addons/<slug>/options` with `{"options": {...}}` replaces all options, so read
  them from `info` first and change only your keys. The same call takes `{"network": {"10000/tcp": 10001}}`
  and `{"ingress_panel": true}`.
- **"Show in sidebar" is off after an install.** Turn it on with `{"ingress_panel": true}`
  before you test the sidebar.
- Update a store app: `post /store/addons/<slug>/update '{"backup":false}'`.

## 3. Install a branch

To test code before a release, install it as a local app. Supervisor builds the image on the VM.

1. Install the official **Terminal & SSH** app (`core_ssh`) with your public key in
   `authorized_keys`, and map its port: `{"network": {"22/tcp": 22}}`.
2. Copy the app folder without `node_modules`, and delete its `image:` line so that Supervisor
   builds from the Dockerfile instead of pulling a release:
   ```bash
   COPYFILE_DISABLE=1 tar -czf - --exclude node_modules trmnl-ha | ssh root@<vm> 'rm -rf /local_apps/trmnl-ha && tar -xzf - -C /local_apps && sed -i "/^image:/d" /local_apps/trmnl-ha/config.yaml'
   ```
   The folder is `/local_apps` on Supervisor 2026.11 (it was `/addons` before).
3. `post /store/reload`, then install `local_trmnl-ha`. Its hostname is `local-trmnl-ha`.
   If the store app also runs, map the local one to another port first.

## 4. Prove it

Test each path that the change touches, from outside the VM, and keep the output:

- **Port 10000**: `curl` each path with and without the secret; compare status and body to what
  the change should do.
- **Sidebar**: sign in with a browser, open `http://<vm>/<slug>` and take a screenshot. The app
  loads in an iframe under `/api/hassio_ingress/<token>/`.
- **Render**: request a Fetch URL with a `viewport` and open the PNG.
- **Automations**: write `configuration.yaml` and `secrets.yaml` over SSH (in `/config`), run
  `ha core check && ha core restart`, then call the action with
  `POST /api/services/<domain>/<action>?return_response` to see the reply.
- **Webhooks**: run a small HTTP server on your computer and point the schedule at it. Under
  QEMU user networking your computer is `10.0.2.2`; with a bridged VM use its LAN address.
- **Logs**: `get /addons/<slug>/logs`, or `ha apps logs <slug>` over SSH.

Tear down what you added (local apps, test schedules, `rest_command` entries) when you finish,
so that the next test starts from a known state.
