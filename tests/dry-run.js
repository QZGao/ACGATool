// Every test runs without network or a real MediaWiki transport.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const forbidden = () => { throw new Error('Dry-run tests must not access the network or MediaWiki storage'); };
globalThis.fetch = forbidden;
http.request = http.get = https.request = https.get = forbidden;
net.connect = net.createConnection = forbidden;
globalThis.mw = {
    Api: class { constructor() { forbidden(); } },
    notify() {},
    config: {get: () => 'Reviewer'},
};
const {default: state} = await import('../src/state.js');
state.init(({hant}) => hant);
