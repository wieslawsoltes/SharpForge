import { PktLineDecoder, encodePktLine } from '../src/protocol/pktline.js';

export function createPktlineFuzzer() {
  const encoder = new TextEncoder();
  return {
    name: 'pktline', corpus: [
      { bytes: encodePktLine('command=fetch\n'), valid: true }, { bytes: encoder.encode('000000010002'), valid: true },
      { bytes: encoder.encode('0003'), valid: false }, { bytes: encoder.encode('ffff'), valid: false }
    ],
    parse(bytes, seed, iteration) {
      const decoder = new PktLineDecoder({ maximum: 4096 });
      const split = iteration % (bytes.length + 1);
      decoder.push(bytes.subarray(0, split));
      decoder.push(bytes.subarray(split));
      decoder.finish();
    }
  };
}
