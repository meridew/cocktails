/**
 * The admission gate, from both sides.
 *
 * A guest orders and is thanked; their drink appears in the bar's queue like anybody
 * else's, flagged as a face nobody has let in yet. It cannot be *advanced* until
 * somebody admits them — and admitting is per person, so it releases everything they
 * have ordered and everything they order for the rest of the night.
 *
 * **The first design hid un-admitted orders instead.** That put the whole feature
 * somewhere nobody was looking, so a bug in the hiding and a guest who never ordered
 * were the same observation. Dan's own wording was "before their order can be
 * *processed*"; this is what that actually meant.
 */
import { test, describe, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { request, send } from './app';
import { asAccount, asBar, barToken, partyFor, person, useMemoryEmail } from './fixtures/people';
import type { Account } from './fixtures/people';
import type { Order } from '$lib/shared';

let dan: Account;
let host: Account;
let eventId = '';
let bar = '';

const order = (name: string, deviceId: string) =>
  request(
    '/api/orders',
    send('POST', { eventId, name, items: [{ name: 'Mojito', qty: 1 }], deviceId }),
  );

async function queue(): Promise<Order[]> {
  const res = await request('/api/orders', { headers: asBar(bar) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { orders: Order[] }).orders;
}

const find = (all: Order[], name: string) => all.find((o) => o.name === name);

beforeAll(async () => {
  useMemoryEmail();
  dan = await person('guests-dan', 'admin');
  host = await person('guests-host');
  eventId = partyFor(host.id, "Host's party");
  bar = await barToken(dan, eventId);
});

describe('a new face reaches the queue, flagged rather than hidden', () => {
  test('their drink is visible immediately, marked as new', async () => {
    assert.equal((await order('Marco', 'dev-marco')).status, 200);
    const mine = find(await queue(), 'Marco');
    assert.ok(mine, 'an un-admitted guest must still appear — hiding them hides the feature');
    assert.equal(mine.newGuest, true);
  });

  test('the guest is told nothing — the gate is one they cannot perceive', async () => {
    const res = await request(
      `/api/events/${eventId}/guests`,
      send('POST', { name: 'Nadia', deviceId: 'dev-nadia' }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true }, 'no status may leak back to the guest');
  });

  test('joining twice does not reset somebody already let in', async () => {
    await order('Repeat', 'dev-repeat');
    await request(`/api/orders/${find(await queue(), 'Repeat')!.id}/admit?eventId=${eventId}`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...asBar(bar) },
    });
    // Reopening the app calls join again. A returning regular must not go back to
    // the start of the night.
    await request(
      `/api/events/${eventId}/guests`,
      send('POST', { name: 'Repeat', deviceId: 'dev-repeat' }),
    );
    assert.equal(find(await queue(), 'Repeat')!.newGuest, false);
  });
});

describe('admitting is per person, not per drink', () => {
  const admit = (id: string, body: Record<string, unknown> = {}) =>
    request(`/api/orders/${id}/admit?eventId=${eventId}`, {
      ...send('POST', body),
      headers: { 'Content-Type': 'application/json', ...asBar(bar) },
    });

  test('one tap releases every round that guest has waiting', async () => {
    await order('Thirsty', 'dev-thirsty');
    await order('Thirsty', 'dev-thirsty');
    const waiting = (await queue()).filter((o) => o.name === 'Thirsty');
    assert.equal(waiting.length, 2);
    assert.ok(waiting.every((o) => o.newGuest));

    assert.equal((await admit(waiting[0]!.id)).status, 200);
    const after = (await queue()).filter((o) => o.name === 'Thirsty');
    assert.ok(
      after.every((o) => !o.newGuest),
      'admitting from one card must clear the others — otherwise the button looks broken',
    );
  });

  test('and everything they order later is ordinary', async () => {
    await order('Thirsty', 'dev-thirsty');
    const latest = (await queue()).filter((o) => o.name === 'Thirsty');
    assert.ok(latest.every((o) => !o.newGuest));
  });

  test('turning somebody away blocks them and bins the drink', async () => {
    await order('Spam', 'dev-spam');
    const theirs = find(await queue(), 'Spam')!;
    assert.equal((await admit(theirs.id, { block: true })).status, 200);
    assert.equal(find(await queue(), 'Spam'), undefined, 'the order should be gone');

    // And they stay out: ordering again puts them back in the un-admitted state
    // rather than sailing through.
    await order('Spam', 'dev-spam');
    assert.equal(find(await queue(), 'Spam')!.newGuest, true);
  });

  test('admit-everyone clears the room in one tap', async () => {
    await order('A', 'dev-a');
    await order('B', 'dev-b');
    const res = await request(`/api/events/${eventId}/guests`, {
      ...send('PATCH', {}),
      headers: { 'Content-Type': 'application/json', ...asBar(bar) },
    });
    const { admitted } = (await res.json()) as { admitted: number };
    assert.ok(admitted >= 2, 'it should report how many, so the screen can say something true');
    // The two who were waiting — not "everything in the queue", because somebody
    // turned away earlier is still un-admitted and rightly stays that way.
    const after = await queue();
    assert.ok(['A', 'B'].every((who) => find(after, who)!.newGuest === false));
  });

  test('a blocked guest is not undone by the bulk button', async () => {
    await order('Banned', 'dev-banned');
    await admit(find(await queue(), 'Banned')!.id, { block: true });
    await request(`/api/events/${eventId}/guests`, {
      ...send('PATCH', {}),
      headers: { 'Content-Type': 'application/json', ...asBar(bar) },
    });
    await order('Banned', 'dev-banned');
    assert.equal(
      find(await queue(), 'Banned')!.newGuest,
      true,
      'a no that was said on purpose is not undone by a convenience button',
    );
  });
});

describe('who may let somebody in', () => {
  test('a host may not — watching is not admitting', async () => {
    await order('Gatecrasher', 'dev-gate');
    const theirs = find(await queue(), 'Gatecrasher')!;
    const res = await request(`/api/orders/${theirs.id}/admit?eventId=${eventId}`, {
      ...send('POST', {}),
      headers: { 'Content-Type': 'application/json', ...asAccount(host) },
    });
    assert.equal(res.status, 403, 'a host is a customer; whoever is pouring decides');
  });

  test('and a stranger certainly may not', async () => {
    const theirs = find(await queue(), 'Gatecrasher')!;
    const res = await request(
      `/api/orders/${theirs.id}/admit?eventId=${eventId}`,
      send('POST', {}),
    );
    assert.equal(res.status, 401);
  });
});
