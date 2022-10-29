import * as sdp from './sdp.js';
import * as p from '@libp2p/peer-id';
import './options.js';
import { WebRTCStream } from './stream.js';
import { Noise } from '@chainsafe/libp2p-noise';
import '@libp2p/interface-connection';
import { symbol } from '@libp2p/interface-transport';
import { logger } from '@libp2p/logger';
import '@multiformats/multiaddr';
import { v4 as genUuid } from 'uuid';
import defer from 'p-defer';
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string';
import { concat } from 'uint8arrays/concat';
import * as multihashes from 'multihashes';
import { dataChannelError, inappropriateMultiaddr, unimplemented, invalidArgument, unsupportedHashAlgorithm } from './error.js';
import { WebRTCMultiaddrConnection } from './maconn.js';
import { DataChannelMuxerFactory } from './muxer.js';
const log = logger('libp2p:webrtc:transport');
const HANDSHAKE_TIMEOUT_MS = 10000;
export class WebRTCTransport {
    constructor(components) {
        this.components = components;
    }
    async dial(ma, options) {
        const rawConn = await this._connect(ma, options);
        log(`dialing address - ${ma}`);
        return rawConn;
    }
    createListener(options) {
        throw unimplemented('WebRTCTransport.createListener');
    }
    filter(multiaddrs) {
        return multiaddrs.filter(validMa);
    }
    get [Symbol.toStringTag]() {
        return '@libp2p/webrtc';
    }
    get [symbol]() {
        return true;
    }
    async _connect(ma, options) {
        const rps = ma.getPeerId();
        if (!rps) {
            throw inappropriateMultiaddr("we need to have the remote's PeerId");
        }
        // ECDSA is preferred over RSA here. From our testing we find that P-256 elliptic
        // curve is supported by Pion, webrtc-rs, as well as Chromium (P-228 and P-384
        // was not supported in Chromium). We fix the hash algorith to SHA-256 for
        // reasons documented here: https://github.com/libp2p/specs/pull/412#discussion_r968327480
        const certificate = await RTCPeerConnection.generateCertificate({
            name: 'ECDSA',
            namedCurve: 'P-256',
            hash: 'SHA-256',
        });
        const peerConnection = new RTCPeerConnection({ certificates: [certificate] });
        // create data channel
        const dataChannelOpenPromise = defer();
        const handshakeDataChannel = peerConnection.createDataChannel('handshake', { negotiated: true, id: 0 });
        const handhsakeTimeout = setTimeout(() => {
            log.error('Data channel never opened. State was: %s', handshakeDataChannel.readyState.toString());
            dataChannelOpenPromise.reject(dataChannelError('data', `data channel was never opened: state: ${handshakeDataChannel.readyState}`));
        }, HANDSHAKE_TIMEOUT_MS);
        handshakeDataChannel.onopen = (_) => {
            clearTimeout(handhsakeTimeout);
            dataChannelOpenPromise.resolve();
        };
        handshakeDataChannel.onerror = (ev) => {
            clearTimeout(handhsakeTimeout);
            log.error('Error opening a data channel for handshaking: %s', ev.toString());
            dataChannelOpenPromise.reject(dataChannelError('data', `error opening datachannel: ${ev.toString()}`));
        };
        // create offer sdp
        let offerSdp = await peerConnection.createOffer();
        // generate random string for ufrag
        const ufrag = genUuid().replaceAll('-', '');
        // munge sdp with ufrag = pwd
        offerSdp = sdp.munge(offerSdp, ufrag);
        // set local description
        await peerConnection.setLocalDescription(offerSdp);
        // construct answer sdp from multiaddr
        const answerSdp = sdp.fromMultiAddr(ma, ufrag);
        // set remote description
        await peerConnection.setRemoteDescription(answerSdp);
        // wait for peerconnection.onopen to fire, or for the datachannel to open
        await dataChannelOpenPromise.promise;
        const myPeerId = this.components.peerId;
        const theirPeerId = p.peerIdFromString(rps);
        // do noise handshake
        //set the Noise Prologue to libp2p-webrtc-noise:<FINGERPRINTS> before starting the actual Noise handshake.
        //  <FINGERPRINTS> is the concatenation of the of the two TLS fingerprints of A and B in their multihash byte representation, sorted in ascending order.
        const fingerprintsPrologue = this.generateNoisePrologue(peerConnection, ma);
        // Since we use the default crypto interface and do not use a static key or early data,
        // we pass in undefined for these parameters.
        const noise = new Noise(undefined, undefined, undefined, fingerprintsPrologue);
        const wrappedChannel = new WebRTCStream({ channel: handshakeDataChannel, stat: { direction: 'outbound', timeline: { open: 1 } } });
        const wrappedDuplex = {
            ...wrappedChannel,
            source: {
                [Symbol.asyncIterator]: async function* () {
                    for await (const list of wrappedChannel.source) {
                        yield list.subarray();
                    }
                },
            },
        };
        // Creating the connection before completion of the noise
        // handshake ensures that the stream opening callback is set up
        const maConn = new WebRTCMultiaddrConnection({
            peerConnection,
            remoteAddr: ma,
            timeline: {
                open: (new Date()).getTime(),
            },
        });
        const muxerFactory = new DataChannelMuxerFactory(peerConnection);
        await noise.secureInbound(myPeerId, wrappedDuplex, theirPeerId);
        const upgraded = await options.upgrader.upgradeOutbound(maConn, { skipProtection: true, skipEncryption: true, muxerFactory });
        return upgraded;
    }
    generateNoisePrologue(pc, ma) {
        if (pc.getConfiguration().certificates?.length === 0) {
            throw invalidArgument('no local certificate');
        }
        const localCert = pc.getConfiguration().certificates?.at(0);
        if (!localCert || localCert.getFingerprints().length === 0) {
            throw invalidArgument('no fingerprint on local certificate');
        }
        const localFingerprint = localCert.getFingerprints()[0];
        const localFpString = localFingerprint.value.replaceAll(':', '');
        const localFpArray = uint8arrayFromString(localFpString, 'hex');
        if (localFingerprint.algorithm != 'sha-256') {
            throw unsupportedHashAlgorithm(localFingerprint.algorithm || 'none');
        }
        const local = multihashes.encode(localFpArray, multihashes.names['sha2-256']);
        const remote = sdp.mbdecoder.decode(sdp.certhash(ma));
        const prefix = uint8arrayFromString('libp2p-webrtc-noise:');
        // prologue = bytes("libp2p-webrtc-noise:") + noise-responder fingerprint + noise-initiator fingerprint
        return concat([prefix, local, remote]);
    }
}
const WEBRTC_CODE = 280;
const CERTHASH_CODE = 466;
function validMa(ma) {
    const codes = ma.protoCodes();
    return codes.includes(WEBRTC_CODE) && codes.includes(CERTHASH_CODE) && ma.getPeerId() != null;
}
//# sourceMappingURL=transport.js.map