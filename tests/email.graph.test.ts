// @vitest-environment node
/**
 * The Graph sender, without a tenant.
 *
 * `fetch` is injected, so every claim below is checked against the two requests
 * Graph actually receives rather than against a mock of our own wrapper. That
 * matters here more than usual: the thing this code talks to needs an app
 * registration only a human can create, so if these tests only exercised our own
 * abstraction, the first real proof would be a host who never got their email.
 */
import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { graphConfigured, graphSender, type GraphConfig } from '$lib/server/email.graph';

const CONFIG: GraphConfig = {
  tenantId: 'tenant-uuid',
  clientId: 'client-uuid',
  clientSecret: 'not-a-real-secret',
  sender: 'bar@meridew.com',
};

const MESSAGE = { to: 'priya@example.com', subject: 'Confirm your email', text: 'Follow this.' };

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records calls and answers with whatever the test queued. */
function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return queue.shift() ?? new Response(null, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const tokenOk = (expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: 'the-token', expires_in: expiresIn }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** Graph answers a successful sendMail with 202 and an empty body. */
const acceptedNoBody = () => new Response(null, { status: 202 });

describe('configuration', () => {
  test('every field is required', () => {
    assert.equal(graphConfigured(CONFIG), true);
    for (const key of ['tenantId', 'clientId', 'clientSecret', 'sender'] as const) {
      assert.equal(graphConfigured({ ...CONFIG, [key]: '' }), false, `${key} should be required`);
    }
  });
});

describe('sending', () => {
  let f: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    f = fakeFetch([tokenOk(), acceptedNoBody()]);
  });

  test('gets a client-credentials token from the right tenant', async () => {
    await graphSender(CONFIG, f.fetch).send(MESSAGE);

    const [tokenCall] = f.calls;
    assert.ok(tokenCall);
    assert.equal(tokenCall.url, 'https://login.microsoftonline.com/tenant-uuid/oauth2/v2.0/token');
    assert.equal(tokenCall.init.method, 'POST');

    const form = new URLSearchParams(String(tokenCall.init.body));
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
    assert.equal(form.get('client_id'), CONFIG.clientId);
  });

  test('posts the message as the configured mailbox', async () => {
    await graphSender(CONFIG, f.fetch).send(MESSAGE);

    const send = f.calls[1];
    assert.ok(send);
    assert.equal(
      send.url,
      'https://graph.microsoft.com/v1.0/users/bar%40meridew.com/sendMail',
      'the sender must be the mailbox the access policy pins us to',
    );
    const headers = send.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer the-token');

    const body = JSON.parse(String(send.init.body)) as {
      message: {
        subject: string;
        body: { contentType: string; content: string };
        toRecipients: { emailAddress: { address: string } }[];
      };
      saveToSentItems: boolean;
    };
    assert.equal(body.message.subject, MESSAGE.subject);
    assert.equal(body.message.body.contentType, 'Text');
    assert.equal(body.message.body.content, MESSAGE.text);
    assert.equal(body.message.toRecipients[0]?.emailAddress.address, MESSAGE.to);
    assert.equal(body.saveToSentItems, false, 'nobody reads that mailbox’s Sent Items');
  });

  test('sends HTML when there is any, and says so', async () => {
    await graphSender(CONFIG, f.fetch).send({ ...MESSAGE, html: '<p>Follow this.</p>' });
    const body = JSON.parse(String(f.calls[1]!.init.body)) as {
      message: { body: { contentType: string; content: string } };
    };
    assert.equal(body.message.body.contentType, 'HTML');
    assert.equal(body.message.body.content, '<p>Follow this.</p>');
  });

  test('202 with an empty body is success, not a parse error', async () => {
    // The obvious bug: calling res.json() on a 202 that has no body.
    await assert.doesNotReject(() => graphSender(CONFIG, f.fetch).send(MESSAGE));
  });
});

describe('the token is cached', () => {
  test('two messages cost one token request', async () => {
    const f = fakeFetch([tokenOk(), acceptedNoBody(), acceptedNoBody()]);
    const sender = graphSender(CONFIG, f.fetch);
    await sender.send(MESSAGE);
    await sender.send(MESSAGE);

    const tokenCalls = f.calls.filter((c) => c.url.includes('/oauth2/'));
    assert.equal(tokenCalls.length, 1, 'a token per message would triple the round trips');
    assert.equal(f.calls.length, 3);
  });

  test('a token about to expire is not reused', async () => {
    // 30s left is inside the 60s margin, so the second send must re-fetch —
    // otherwise a slow send races the expiry and fails for no visible reason.
    const f = fakeFetch([tokenOk(30), acceptedNoBody(), tokenOk(3600), acceptedNoBody()]);
    const sender = graphSender(CONFIG, f.fetch);
    await sender.send(MESSAGE);
    await sender.send(MESSAGE);

    assert.equal(f.calls.filter((c) => c.url.includes('/oauth2/')).length, 2);
  });
});

describe('failures say something useful', () => {
  test('a rejected secret surfaces the status', async () => {
    const f = fakeFetch([new Response('{"error":"invalid_client"}', { status: 401 })]);
    await assert.rejects(
      () => graphSender(CONFIG, f.fetch).send(MESSAGE),
      /token request failed \(HTTP 401\)/,
    );
  });

  test('and does not echo the credentials into the log', async () => {
    // This message ends up in the server log, where the client id and secret must
    // not. Client secrets last 24 months and nothing reminds us to rotate them, so
    // a leaked one is a long-lived problem.
    const f = fakeFetch([new Response(`{"client_id":"${CONFIG.clientId}"}`, { status: 400 })]);
    await graphSender(CONFIG, f.fetch)
      .send(MESSAGE)
      .then(
        () => assert.fail('should have rejected'),
        (err: Error) => {
          assert.ok(!err.message.includes(CONFIG.clientSecret));
          assert.ok(!err.message.includes(CONFIG.clientId));
        },
      );
  });

  test('a refused send surfaces the status', async () => {
    const f = fakeFetch([tokenOk(), new Response('{"error":"forbidden"}', { status: 403 })]);
    await assert.rejects(
      () => graphSender(CONFIG, f.fetch).send(MESSAGE),
      /sendMail failed \(HTTP 403\)/,
    );
  });
});
