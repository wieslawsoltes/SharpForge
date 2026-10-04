"""Correlate browser failures with exact native fixture responses without discarding failure evidence."""
from urllib.parse import urlsplit


class CloneNetworkEvents:
    def __init__(self, events, remote_origin):
        self.events, self.remote_origin = events, remote_origin
        self.identities = {}
        events['gitResponses'] = []

    def identity(self, request):
        if request not in self.identities:
            self.identities[request] = len(self.identities)
        return self.identities[request]

    def response(self, response):
        parsed = urlsplit(response.url)
        if parsed.scheme + '://' + parsed.netloc != self.remote_origin:
            return
        request = response.request
        sequence = response.headers.get('x-sharpforge-fixture-sequence', '')
        row = {'requestId': self.identity(request), 'url': request.url, 'method': request.method,
               'status': response.status, 'fixtureSequence': int(sequence) if sequence.isdecimal() else None,
               'authorizationPresent': any(name.lower() == 'authorization' for name in request.all_headers())}
        self.events['gitResponses'].append(row)

    def failure(self, request):
        self.events['requestFailures'].append({'requestId': self.identity(request), 'url': request.url,
                                              'method': request.method, 'error': request.failure})


def expected_authentication_cancellations(events, remote, server_requests):
    """Recognize only one disposed anonymous 401, after the exact authenticated retry and object transfer."""
    if not remote:
        return []
    discovery = remote + '/info/refs?service=git-upload-pack'
    discovery_path = urlsplit(discovery).path
    upload = remote + '/git-upload-pack'

    def native(row, path, method, status, authenticated):
        return (row.get('path') == path and row.get('method') == method and row.get('status') == status
                and row.get('authorizationPresent') is authenticated and row.get('authenticated') is authenticated
                and row.get('forwarded') is authenticated and not row.get('error'))

    def browser(row, url, method, status, authenticated):
        return (row.get('url') == url and row.get('method') == method and row.get('status') == status
                and row.get('authorizationPresent') is authenticated)

    challenges = [row for row in server_requests if native(row, discovery_path, 'GET', 401, False)]
    if len(challenges) != 1:
        return []
    challenge = challenges[0]
    retries = [row for row in server_requests if native(row, discovery_path, 'GET', 200, True)
               and row['sequence'] > challenge['sequence']]
    if not retries:
        return []
    retry = retries[0]
    transfers = [row for row in server_requests if native(row, urlsplit(upload).path, 'POST', 200, True)
                 and row['sequence'] > retry['sequence'] and row.get('responseBytes', 0) > 0]
    if not transfers:
        return []
    responses = events.get('gitResponses', [])
    observed_challenges = [row for row in responses if browser(row, discovery, 'GET', 401, False)
                           and row.get('fixtureSequence') == challenge['sequence']]
    observed_retries = [row for row in responses if browser(row, discovery, 'GET', 200, True)
                       and row.get('fixtureSequence') == retry['sequence']]
    observed_transfers = [row for row in responses if browser(row, upload, 'POST', 200, True)
                         and any(row.get('fixtureSequence') == transfer['sequence'] for transfer in transfers)]
    if len(observed_challenges) != 1 or not observed_retries or not observed_transfers:
        return []
    observed = observed_challenges[0]
    for index, failure in enumerate(events['requestFailures']):
        if (failure.get('error') == 'net::ERR_ABORTED' and failure.get('url') == discovery
                and failure.get('method') == 'GET' and failure.get('requestId') == observed['requestId']):
            return [{'failureIndex': index, 'requestId': observed['requestId'], 'fixtureSequence': challenge['sequence'],
                     'authenticatedRetrySequence': retry['sequence'], 'uploadSequence': observed_transfers[0]['fixtureSequence'],
                     'reason': 'anonymous 401 response body disposed before successful authenticated retry'}]
    return []
