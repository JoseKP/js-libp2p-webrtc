import * as underTest from '../src/transport.js';
import { UnimplementedError } from '../src/error.js';
import { Components } from '@libp2p/components';
import { mockUpgrader } from '@libp2p/interface-mocks';
import { CreateListenerOptions, symbol } from '@libp2p/interface-transport';
import { Multiaddr } from '@multiformats/multiaddr';
import { expect } from 'chai';

function ignoredDialOption(): CreateListenerOptions {
    let u = mockUpgrader({});
    return {
        upgrader: u
    };
}

describe('basic transport tests', () => {

  it('Can construct', () => {
    let t = new underTest.WebRTCTransport();
    expect(t.constructor.name).to.equal('WebRTCTransport');
  });

  it('init does not throw', () => {
    let t = new underTest.WebRTCTransport();
    t.init(new Components());
  });

  it('createListner does throw', () => {
    let t = new underTest.WebRTCTransport();
    try {
      t.createListener(ignoredDialOption());
      expect('Should have thrown').to.equal('but did not');
    } catch (e) {
      expect(e).to.be.instanceOf(UnimplementedError);
    }
  });

  it('toString includes the toStringTag', () => {
    let t = new underTest.WebRTCTransport();
    let s = t.toString();
    expect(s).to.contain('@libp2p/webrtc');
  });

  it('toString property getter', () => {
    let t = new underTest.WebRTCTransport();
    let s = t[Symbol.toStringTag];
    expect(s).to.equal('@libp2p/webrtc');
  });

  it('symbol property getter', () => {
    let t = new underTest.WebRTCTransport();
    let s = t[symbol];
    expect(s).to.equal(true);
  });

  it('filter gets rid of some invalids and returns a valid', async () => {
    let mas: Multiaddr[] = [
      '/ip4/1.2.3.4/udp/1234/webrtc/certhash/uEiAUqV7kzvM1wI5DYDc1RbcekYVmXli_Qprlw3IkiEg6tQ',
      '/ip4/1.2.3.4/udp/1234/webrtc/certhash/uEiAUqV7kzvM1wI5DYDc1RbcekYVmXli_Qprlw3IkiEg6tQ/p2p/12D3KooWGDMwwqrpcYKpKCgxuKT2NfqPqa94QnkoBBpqvCaiCzWd',
      '/ip4/1.2.3.4/udp/1234/webrtc/p2p/12D3KooWGDMwwqrpcYKpKCgxuKT2NfqPqa94QnkoBBpqvCaiCzWd',
      '/ip4/1.2.3.4/udp/1234/certhash/uEiAUqV7kzvM1wI5DYDc1RbcekYVmXli_Qprlw3IkiEg6tQ/p2p/12D3KooWGDMwwqrpcYKpKCgxuKT2NfqPqa94QnkoBBpqvCaiCzWd',
    ].map((s) => {
      return new Multiaddr(s);
    });
    let t = new underTest.WebRTCTransport();
    let result = t.filter(mas);
    let expected: Multiaddr[] = [
      new Multiaddr('/ip4/1.2.3.4/udp/1234/webrtc/certhash/uEiAUqV7kzvM1wI5DYDc1RbcekYVmXli_Qprlw3IkiEg6tQ/p2p/12D3KooWGDMwwqrpcYKpKCgxuKT2NfqPqa94QnkoBBpqvCaiCzWd'),
    ];
    expect(result).to.not.be.null();
    expect(result.constructor.name).to.equal('Array');
    expect(expected.constructor.name).to.equal('Array');
    expect(result).to.eql(expected);
  });

  it('throws appropriate error when dialing someone without a peer ID', async () => {
    let ma = new Multiaddr('/ip4/1.2.3.4/udp/1234/webrtc/certhash/uEiAUqV7kzvM1wI5DYDc1RbcekYVmXli_Qprlw3IkiEg6tQ');
    let t = new underTest.WebRTCTransport();
    try {
      let conn = await t.dial(ma, ignoredDialOption());
      expect(conn.toString()).to.equal('Should have thrown');
    } catch (e) {
      expect(e).to.be.instanceOf(Error);
      if (e instanceof Error) {
        // let err: Error = e;
        expect(e.message).to.contain('PeerId');
      }
    }
  });

  it('Connects to manually started listener on localhost', async () => {
    let ma = new Multiaddr('/ip4/192.168.0.152/udp/40972/webrtc/certhash/uEiD0EMqK00oTPBJ87G7uTUePqN-ZXP4tZ70HmcFCdntyhg');
    let t = new underTest.WebRTCTransport();
    let conn = await t.dial(ma, ignoredDialOption());
    expect(conn.id).to.equal('?');
  });
});

