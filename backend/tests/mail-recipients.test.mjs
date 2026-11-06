// npm run build && node --experimental-test-module-mocks tests/mail-recipients.test.mjs
// Sends replication alert e-mails to a throwaway SMTP listener on 127.0.0.1 and checks
// the envelope recipients. No real mail server is contacted.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';

const errors = [];
mock.module('../dist/utils/logger.js', { namedExports: { logger: {
  info() {}, warn() {}, debug() {}, error(...args) { errors.push(args); },
} } });
const { sendAlert } = await import('../dist/services/replicationAlerts.js');

// Just enough SMTP for nodemailer: no STARTTLS, no AUTH, accepts everything.
async function smtpSink(t) {
  const messages = [];
  const server = createServer(socket => {
    const message = { rcpt: [] };
    let buffer = '', inData = false;
    socket.write('220 sink.invalid ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while (inData ? (end = buffer.indexOf('\r\n.\r\n')) !== -1 : (end = buffer.indexOf('\r\n')) !== -1) {
        if (inData) {
          buffer = buffer.slice(end + 5);
          inData = false;
          messages.push(message);
          socket.write('250 queued\r\n');
          continue;
        }
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const rcpt = line.match(/^RCPT TO:<(.*)>/i);
        if (rcpt) message.rcpt.push(rcpt[1]);
        if (/^DATA/i.test(line)) { inData = true; socket.write('354 go ahead\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.end('221 bye\r\n'); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { port: server.address().port, messages };
}

let seq = 0;
async function recipientsFor(t, to) {
  const sink = await smtpSink(t);
  errors.length = 0;
  // A distinct event type each time keeps sendAlert's per-type rate limit out of the way.
  await sendAlert({ id: 'e', target_id: 'test', type: `test_${seq++}`, severity: 'error', message: 'synthetic' },
    [{ id: 'c', type: 'email', enabled: true,
       config_json: { host: '127.0.0.1', port: sink.port, secure: false, from: 'stor@good.invalid', to } }]);
  assert.deepEqual(errors, []);
  assert.equal(sink.messages.length, 1);
  return sink.messages[0].rcpt;
}

test('plain recipient lists are delivered as written', async t => {
  assert.deepEqual(await recipientsFor(t, 'ops@good.invalid'), ['ops@good.invalid']);
  assert.deepEqual(await recipientsFor(t, 'Ops Team <ops@good.invalid>, "Second, On Call" <second@good.invalid>'),
                   ['ops@good.invalid', 'second@good.invalid']);
});

// GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h: text that RFC 5322 reads
// as a comment, display name or quoted local part was turned into the envelope recipient.
test('comments, groups and quoted local parts cannot inject a recipient', async t => {
  assert.deepEqual(await recipientsFor(t, 'Victim (x(y) <evil@evil.invalid>) <v@good.invalid>'), ['v@good.invalid']);
  assert.deepEqual(await recipientsFor(t, 'G: (a; <evil@evil.invalid>) <v@good.invalid>;'), ['v@good.invalid']);
  assert.deepEqual(await recipientsFor(t, 'G: "a;" "<evil@evil.invalid>" <v@good.invalid>;'), ['v@good.invalid']);
  for (const rcpt of await recipientsFor(t, '<"a@evil.invalid>"@good.invalid>')) {
    assert.match(rcpt, /@good\.invalid$/);
  }
});
