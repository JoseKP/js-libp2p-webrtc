import { logger }    from '@libp2p/logger'
import { Multiaddr } from '@multiformats/multiaddr'

const log = logger('libp2p:webrtc:sdp')

const P_XWEBRTC: number = 0x118;
// rename to ANSWER_SDP_FORMAT
const SDP_FORMAT: string = `
v=0
o=- 0 0 IN %s %s
s=-
c=IN %s %s
t=0 0
m=application %d UDP/DTLS/SCTP webrtc-datachannel
a=mid:0
a=ice-options:ice2
a=ice-ufrag:%s
a=ice-pwd:%s
a=fingerprint:%s
a=setup:actpass
a=sctp-port:5000
a=max-message-size:100000
`;

function ipv(ma: Multiaddr): string {
    for ( let proto of ma.protoNames() ) {
        if ( proto.startsWith('ip') ) {
            return proto.toUpperCase();
        }
    }
    log("Warning: multiaddr does not appear to contain IP4 or IP6.",ma);
    return "IP6";
}
function ip(ma: Multiaddr): string {
    return ma.toOptions().host;
}
function port(ma: Multiaddr): number {
    return ma.toOptions().port;
}
function certhash(ma: Multiaddr): string {
    let webrtc_value = ma.stringTuples().filter(tup => tup[0] == P_XWEBRTC).map(tup => tup[1])[0];
    if (webrtc_value) {
        return webrtc_value.split('/')[1];
    } else {
        throw new Error("Couldn't find a webrtc component of multiaddr:"+ma.toString());
    }
}

function ma2sdp(ma: Multiaddr, ufrag: string): string {
    return SDP_FORMAT.replace('/%s/', ipv(ma))
        .replace('/%s/', ip(ma))
        .replace('/%s/', ipv(ma))
        .replace('/%s/', ip(ma))
        .replace('/%s/', port(ma).toString())
        .replace('/%s/', ufrag)
        .replace('/%s/', ufrag)
        .replace('/%s/', certhash(ma))
        ;
}

export function fromMultiAddr(ma: Multiaddr, ufrag: string): RTCSessionDescriptionInit {
    return {
        type: "offer",
        sdp: ma2sdp(ma,ufrag)
    };
}

function munge(desc: RTCSessionDescription, ufrag: string) {
	desc.sdp.replaceAll(/^a=ice-ufrag=(.*)/, "a=ice-ufrag="+ufrag)
	desc.sdp.replaceAll(/^a=ice-pwd=(.*)/, "a=ice-pwd="+ufrag)
}
