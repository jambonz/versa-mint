'use strict';

const {buildReferPassthrough} = require('../lib/routes/utils');

const URI_PARAMS = '<sip:transfer-target@refer.example.invalid;user=phone;transport=tcp>';
const URI_HEADER = '<sip:+61399301264@eims-asd-201and202.itrunk.business.connect.telstra.com' +
  '?X-Vapi-Call-Id=01a07bde-a47b-799f-a444-56afa78ec458>';

describe('buildReferPassthrough: referTo', () => {
  test('relays a uri with params rather than reducing it to the user part', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      refer_to_user: 'transfer-target'
    }).referTo).toBe(URI_PARAMS);
  });

  test('relays an embedded uri header', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_HEADER,
      refer_to_user: '+61399301264'
    }).referTo).toBe(URI_HEADER);
  });

  test.each([
    ['bare sip uri', 'sip:alice@pbx.local'],
    ['quoted display name', '"Alice" <sip:alice@pbx.local>'],
    ['tel uri', 'tel:+15551234567']
  ])('relays a %s', (_label, value) => {
    expect(buildReferPassthrough({sip_refer_to: value, refer_to_user: 'alice'}).referTo)
      .toBe(value);
  });

  // Forms jambonz would mangle into sip:<whole value>@<sbc-host> — the user part
  // is the only safe thing to send.
  test.each([
    ['unquoted display name', 'Alice <sip:alice@pbx.local>'],
    ['sips uri', 'sips:alice@pbx.local']
  ])('falls back to refer_to_user for a %s', (_label, value) => {
    expect(buildReferPassthrough({sip_refer_to: value, refer_to_user: 'alice'}).referTo)
      .toBe('alice');
  });

  test('falls back to refer_to_user when sip_refer_to is absent', () => {
    expect(buildReferPassthrough({refer_to_user: 'someuser'}).referTo).toBe('someuser');
  });
});

describe('buildReferPassthrough: headers', () => {
  test('relays custom x_ headers, title-cased back to SIP form', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      x_versa_custom: 'passthrough-value',
      x_account_ref: 'acct-42'
    }).headers).toEqual({
      'X-Versa-Custom': 'passthrough-value',
      'X-Account-Ref': 'acct-42'
    });
  });

  test('withholds this app\'s own directives', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      x_dest: 'sip:+15553334444@pbx.example.com',
      x_digits_delay: 'ppp1',
      x_caller_id: '+15551112222',
      x_reset: 'true',
      x_dial_music: 'http://example.com/hold.wav'
    }).headers).toBeUndefined();
  });

  test('withholds the shared secret and this app\'s own call identifiers', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      x_versa_sip_key: 'super-secret',
      x_original_call_sid: 'abc-123',
      x_original_caller_id: '+15550001111',
      x_phone_number: '+15550002222'
    }).headers).toBeUndefined();
  });

  test('ignores refer_details metadata that is not an x_ header', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      sip_user_agent: 'some-pbx',
      referring_call_sid: 'abc-123',
      referred_call_sid: 'def-456',
      referred_by_user: 'callee'
    }).headers).toBeUndefined();
  });
});

describe('buildReferPassthrough: referredBy', () => {
  test('relays the original referrer when the REFER named one', () => {
    expect(buildReferPassthrough({
      sip_refer_to: URI_PARAMS,
      sip_referred_by: '<sip:callee@example.invalid>'
    }).referredBy).toBe('<sip:callee@example.invalid>');
  });

  test('omitted when absent, so jambonz supplies its own default', () => {
    expect(buildReferPassthrough({sip_refer_to: URI_PARAMS}))
      .not.toHaveProperty('referredBy');
  });
});
