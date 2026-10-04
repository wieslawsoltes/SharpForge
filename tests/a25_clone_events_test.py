"""Positive and negative contracts for the narrow native 401 response-disposal exception."""
from copy import deepcopy
from types import SimpleNamespace
import unittest

from a25_clone_events import CloneNetworkEvents, expected_authentication_cancellations


REMOTE = 'https://127.0.0.1:443/private.git'
DISCOVERY = REMOTE + '/info/refs?service=git-upload-pack'


def observations():
    responses = [
        {'requestId': 0, 'url': DISCOVERY, 'method': 'GET', 'status': 401,
         'fixtureSequence': 7, 'authorizationPresent': False},
        {'requestId': 1, 'url': DISCOVERY, 'method': 'GET', 'status': 200,
         'fixtureSequence': 9, 'authorizationPresent': True},
        {'requestId': 2, 'url': REMOTE + '/git-upload-pack', 'method': 'POST', 'status': 200,
         'fixtureSequence': 11, 'authorizationPresent': True}
    ]
    rows = [{'sequence': row['fixtureSequence'],
             'path': '/private.git/info/refs' if row['method'] == 'GET' else '/private.git/git-upload-pack',
             'method': row['method'], 'status': row['status'], 'authorizationPresent': row['authorizationPresent'],
             'authenticated': row['authorizationPresent'], 'forwarded': row['authorizationPresent'],
             'responseBytes': 128 if row['authorizationPresent'] else 0} for row in responses]
    events = {'gitResponses': responses, 'requestFailures': [
        {'requestId': 0, 'url': DISCOVERY, 'method': 'GET', 'error': 'net::ERR_ABORTED'}
    ]}
    return events, rows


class AuthenticationCancellationContracts(unittest.TestCase):
    def test_response_and_failure_order_preserve_request_identity_without_storing_token_values(self):
        class Request:
            url, method, failure = DISCOVERY, 'GET', 'net::ERR_ABORTED'

            def __init__(self, authenticated=False):
                self.authenticated = authenticated

            def all_headers(self):
                return {'Authorization': 'Bearer planted-fixture-token'} if self.authenticated else {}

        events = {'requestFailures': []}
        observer = CloneNetworkEvents(events, 'https://127.0.0.1:443')
        challenge, retry = Request(), Request(True)
        observer.failure(challenge)
        for request, status, sequence in [(challenge, 401, '7'), (retry, 200, '9')]:
            observer.response(SimpleNamespace(url=DISCOVERY, request=request, status=status,
                                              headers={'x-sharpforge-fixture-sequence': sequence}))
        self.assertEqual(events['requestFailures'][0]['requestId'], events['gitResponses'][0]['requestId'])
        self.assertNotEqual(events['gitResponses'][0]['requestId'], events['gitResponses'][1]['requestId'])
        self.assertFalse(events['gitResponses'][0]['authorizationPresent'])
        self.assertTrue(events['gitResponses'][1]['authorizationPresent'])
        self.assertNotIn('planted-fixture-token', repr(events))

    def test_exact_anonymous_challenge_is_recognized_without_removing_raw_failure(self):
        events, rows = observations()
        original = deepcopy(events)
        accepted = expected_authentication_cancellations(events, REMOTE, rows)
        self.assertEqual([item['failureIndex'] for item in accepted], [0])
        self.assertEqual(accepted[0]['fixtureSequence'], 7)
        self.assertEqual(accepted[0]['authenticatedRetrySequence'], 9)
        self.assertEqual(accepted[0]['uploadSequence'], 11)
        self.assertEqual(events, original)
        self.assertEqual(expected_authentication_cancellations(events, None, rows), [])

    def test_other_request_id_url_method_or_failure_stays_fatal(self):
        for field, value in [('requestId', 1), ('url', REMOTE + '/git-upload-pack'),
                             ('url', DISCOVERY.replace('127.0.0.1', 'localhost')),
                             ('method', 'OPTIONS'), ('error', 'net::ERR_CONNECTION_RESET')]:
            with self.subTest(field=field, value=value):
                events, rows = observations()
                events['requestFailures'][0][field] = value
                self.assertEqual(expected_authentication_cancellations(events, REMOTE, rows), [])

    def test_challenge_needs_matching_browser_and_native_401_without_credentials(self):
        for source, field, value in [('browser', 'status', 200), ('browser', 'authorizationPresent', True),
                                     ('browser', 'fixtureSequence', 9), ('native', 'status', 403),
                                     ('native', 'authorizationPresent', True), ('native', 'forwarded', True)]:
            with self.subTest(source=source, field=field):
                events, rows = observations()
                target = events['gitResponses'][0] if source == 'browser' else rows[0]
                target[field] = value
                self.assertEqual(expected_authentication_cancellations(events, REMOTE, rows), [])

    def test_authenticated_retry_and_object_transfer_are_both_required(self):
        for index in [1, 2]:
            for source in ['browser', 'native']:
                with self.subTest(index=index, source=source):
                    events, rows = observations()
                    target = events['gitResponses'] if source == 'browser' else rows
                    target.pop(index)
                    self.assertEqual(expected_authentication_cancellations(events, REMOTE, rows), [])
        events, rows = observations()
        rows[2]['responseBytes'] = 0
        self.assertEqual(expected_authentication_cancellations(events, REMOTE, rows), [])
        events, rows = observations()
        rows[1]['sequence'] = 6
        self.assertEqual(expected_authentication_cancellations(events, REMOTE, rows), [])

    def test_duplicate_and_additional_failures_are_not_all_accepted(self):
        events, rows = observations()
        events['requestFailures'].append(dict(events['requestFailures'][0]))
        events['requestFailures'].append({'requestId': 2, 'url': REMOTE + '/git-upload-pack',
                                          'method': 'POST', 'error': 'net::ERR_ABORTED'})
        accepted = expected_authentication_cancellations(events, REMOTE, rows)
        remaining = [failure for index, failure in enumerate(events['requestFailures'])
                     if index not in {item['failureIndex'] for item in accepted}]
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(remaining), 2)


if __name__ == '__main__':
    unittest.main()
