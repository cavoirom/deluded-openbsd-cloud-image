import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const [key, knownHosts] = process.argv.slice(2);
assert(key && knownHosts, 'Supply the SSH key and known_hosts paths');
const options = ['-i', key, '-p', '2222', '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
  '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`];
const password = `Aa!9${randomBytes(24).toString('hex')}`;

async function session(command, steps, expected, code = 0, timeout = 90000, user = 'cavoirom') {
  const output = await new Promise((resolve, reject) => {
    const child = spawn('ssh', [...options, '-tt', `${user}@127.0.0.1`, command]);
    let text = '', cursor = 0, step = 0;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error(`SSH command timed out: ${command}`);
      child.kill('SIGTERM');
    }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { failure = error; });
    const receive = data => {
      text += data.toString();
      if (/Old password:/i.test(text)) {
        failure = new Error('First password setup requested an old password');
        child.kill('SIGTERM');
      }
      if (step < steps.length && steps[step][0].test(text.slice(cursor))) {
        cursor = text.length;
        child.stdin.write(`${steps[step++][1]}\n`);
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('close', status => {
      clearTimeout(timer);
      try {
        if (failure) throw failure;
        assert.equal(status, code, command);
        assert.equal(step, steps.length, 'Required authentication prompts');
        assert.match(text.replaceAll('\r', ''), expected, command);
        resolve(text);
      } catch (error) {
        console.error(text.replaceAll(password, '[REDACTED]'));
        reject(error);
      }
    });
  });
  return output;
}

const emptyAttempts = Array.from({ length: 3 }, () => [/password:/i, '']);
await session('doas id -u', emptyAttempts, /Authentication failed/, 1);
console.log('PASS: no empty-password doas access before password setup');

await session('true', [], /Permission denied/, 255, 90000, 'root');
console.log('PASS: root SSH denied');

await session('passwd', [
  [/New password:/, password],
  [/Retype new password:/, password],
], /password updated successfully/);
console.log('PASS: first password set without an old password');

const policy = await session(`doas /bin/ksh -c '
set -e
test "$(id -u)" = 0
test -x /usr/local/bin/python3
if pkg_info -e "sudo-*"; then exit 1; fi
cloud-init status --long
for setting in "AllowUsers cavoirom" "AuthenticationMethods publickey" \
    "PermitRootLogin no" "PasswordAuthentication no" \
    "KbdInteractiveAuthentication no" "PermitEmptyPasswords no"; do
    /usr/sbin/sshd -G | grep -qx "$setting"
done
grep -qx "permit persist cavoirom as root" /etc/doas.conf
test "$(grep -c "^permit " /etc/doas.conf)" = 1
ssh-keygen -lf /home/cavoirom/.ssh/authorized_keys
for host_key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$host_key"; done
cloud-init single --name users_groups --frequency always
echo POLICY_OK
'`, [[/password:/i, password]], /POLICY_OK/);
assert.match(policy, /SHA256:SsTE9PvULORJwjioNrkjfOfb316J\+p\+\/9FYeDfM7tGs/,
  'The owner hardware key must be installed alongside the metadata key');
const hostFingerprint = execFileSync('ssh-keygen', ['-lf', knownHosts], { encoding: 'utf8' })
  .match(/SHA256:\S+/)[0];
assert(policy.includes(hostFingerprint), 'Disk and running SSH host keys must match');
console.log('PASS: account, SSH, doas, keys, Python, and sudo policy');

await session('doas -L; doas id -u && doas id -u; doas -L; doas id -u', [
  [/password:/i, password],
  [/password:/i, password],
], /0\n0\n[\s\S]*0\n/);
console.log('PASS: password preserved after cloud-init rerun and terminal cache works');

await session('doas -L; doas id -u',
  Array.from({ length: 3 }, () => [/password:/i, 'incorrect-password']),
  /Authentication failed/, 1);
console.log('PASS: incorrect password denied on a separate terminal');

await session('doas -L; doas id -u && doas id -u && sleep 305 && doas id -u', [
  [/password:/i, password], ...emptyAttempts,
], /0\n0\n[\s\S]*Authentication failed/, 1, 400000);
console.log('PASS: native terminal cache expires after five minutes');
