# Qcow2 image builder for OpenBSD

Builds OpenBSD 8.0 amd64 Qcow2 images with Python and [cloud-init](https://cloud-init.io/).

## Build host requirements

* `python3`
* `sudo`
* `curl`
* `signify` (Debian: `signify-openbsd` and `signify-openbsd-keys`)
* `qemu-system-x86_64`
* `qemu-img`

The guest uses 2 GiB RAM during builds and tests.

## Usage

* Clone the git repository
* Run: `./build_openbsd_qcow2.sh -b`
* Done

See `./build_openbsd_qcow2.sh -h` for more information.

## Access

* Only `cavoirom` can SSH, with a public key; root and password SSH are disabled.
* Review the owner key in `custom/install.site`; cloud-init installs it and platform metadata keys.
* After the first SSH login, run `passwd` to set your password without a current password.
* Use `doas` for root commands; it requires your password and uses the native five-minute terminal cache.
* Python remains installed for cloud-init; the guest has no sudo.

## Tips

* Build a standard image: `./build_openbsd_qcow2.sh -r 8.0 --image-file openbsd.qcow2 -b`
* Build a minimal image: `./build_openbsd_qcow2.sh -r 8.0 --image-file openbsd-min.qcow2 --size 2 --disklabel custom/disklabel.cloud --sets "-game*.tgz -x*.tgz" -b`
* For manual disk setup, adjust `/root/bin/create_partitions.sh` to your layout before running it.

## CI and validation

Manual CI uses this repository's workflows to build and test both images before publishing a release.
Tests cover cloud-init completion, SSH and key policy, first-password setup, doas authentication and cache expiry, Python, and sudo absence.

Local ARM64 QEMU tests passed; the amd64 CI and DigitalOcean tests remain unverified.
