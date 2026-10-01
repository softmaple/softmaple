/**
 * CRC-32 (IEEE 802.3, the zlib/PNG polynomial) of a byte range.
 *
 * EGW4 payloads end with this checksum, so a flipped or dropped byte is
 * reported as corruption instead of decoding to a different graph: CRC-32
 * detects every error burst of up to 32 bits. It is not a defense against a
 * crafted payload, which can carry a matching checksum.
 */
const CRC32_TABLES = ((): Int32Array => {
  // Slicing-by-4: table `t` advances the CRC over a byte followed by `t`
  // zero bytes, so the main loop folds four bytes per iteration.
  const tables = new Int32Array(4 * 256);
  for (let byte = 0; byte < 256; byte++) {
    let crc = byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
    }
    tables[byte] = crc;
  }
  for (let byte = 0; byte < 256; byte++) {
    let crc = tables[byte]!;
    for (let table = 1; table < 4; table++) {
      crc = tables[crc & 0xff]! ^ (crc >>> 8);
      tables[table * 256 + byte] = crc;
    }
  }
  return tables;
})();

export const crc32 = (bytes: Uint8Array): number => {
  const tables = CRC32_TABLES;
  let crc = -1;
  let index = 0;
  const end4 = bytes.length - (bytes.length % 4);
  while (index < end4) {
    crc ^=
      bytes[index]! |
      (bytes[index + 1]! << 8) |
      (bytes[index + 2]! << 16) |
      (bytes[index + 3]! << 24);
    crc =
      tables[768 + (crc & 0xff)]! ^
      tables[512 + ((crc >>> 8) & 0xff)]! ^
      tables[256 + ((crc >>> 16) & 0xff)]! ^
      tables[crc >>> 24]!;
    index += 4;
  }
  while (index < bytes.length) {
    crc = tables[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
    index++;
  }
  return (crc ^ -1) >>> 0;
};
