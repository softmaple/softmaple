import { describe, expect, it, vi } from "vitest";

import { PortableSnapshotCodec } from "../core/portable-snapshot-codec";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import type { GraphEvent } from "../types";

const codec = new PortableSnapshotCodec();

const hmacKey = (hash = "SHA-256"): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: "HMAC", hash }, false, ["sign", "verify"]);

const history: ReadonlyArray<GraphEvent> = [
  {
    id: "remote:0",
    operation: { type: "insert", index: 0, text: "Hello" },
    parentVersion: new Set(),
    timestamp: 1,
  },
  {
    id: "alice:0",
    operation: { type: "insert", index: 5, text: " world" },
    parentVersion: new Set(["remote:0"]),
    timestamp: 2,
  },
  {
    id: "bob:0",
    operation: { type: "insert", index: 0, text: ">" },
    parentVersion: new Set(["remote:0"]),
    timestamp: 3,
  },
];

const source = (): EgWalkerReplica => {
  const replica = new EgWalkerReplica("source");
  replica.applyRemoteEvents(history);
  return replica;
};

/**
 * Spy on every replay that could prove a snapshot's text. A packed range
 * replay, run at once or in steps, always goes through the steps method.
 */
const spyOnReplays = () => {
  const spies = [
    vi.spyOn(EgWalkerEngine.prototype, "generate"),
    vi.spyOn(EgWalkerEngine.prototype, "generatePackedSectionRangeSteps"),
  ];
  return {
    calls: (): number =>
      spies.reduce((count, spy) => count + spy.mock.calls.length, 0),
    restore: (): void => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
};

describe("PortableSnapshotCodec authentication", () => {
  it("restores authenticated bytes without a validation replay", async () => {
    // Arrange: the bytes lose their in-process identity when stored.
    const key = await hmacKey();
    const written = codec.encode(source().createPortableSnapshot());
    const tag = await codec.authenticate(written, key);
    const stored = written.slice();
    const replays = spyOnReplays();

    try {
      // Act
      const replica = EgWalkerReplica.fromPortableSnapshot(
        await codec.decodeAuthenticated(stored, tag, key),
        "reader",
      );
      await replica.prepare();
      replica.insert(0, "!");

      // Assert
      expect(replays.calls()).toBe(0);
      expect(tag).toHaveLength(32);
      expect(replica.getText()).toBe(`!${source().getText()}`);
      expect(replica.getReplayStats().snapshotValidationReplays).toBe(0);
    } finally {
      replays.restore();
    }
  });

  it("rejects changed bytes, a changed tag, and another key", async () => {
    // Arrange
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot());
    const tag = await codec.authenticate(bytes, key);
    const changedBytes = bytes.slice();
    changedBytes[changedBytes.length - 1]! ^= 0x01;
    const changedTag = tag.slice();
    changedTag[0]! ^= 0x01;

    // Act and assert
    await expect(
      codec.decodeAuthenticated(changedBytes, tag, key),
    ).rejects.toThrow(/authentication tag does not match/);
    await expect(
      codec.decodeAuthenticated(bytes, changedTag, key),
    ).rejects.toThrow(/authentication tag does not match/);
    await expect(
      codec.decodeAuthenticated(bytes, tag.subarray(0, 16), key),
    ).rejects.toThrow(/authentication tag does not match/);
    await expect(
      codec.decodeAuthenticated(bytes, tag, await hmacKey()),
    ).rejects.toThrow(/authentication tag does not match/);
  });

  it("keeps opening bytes that fail authentication as untrusted", async () => {
    // Arrange
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot()).slice();
    const tag = await codec.authenticate(bytes, key);

    // Act
    await expect(
      codec.decodeAuthenticated(bytes, tag, await hmacKey()),
    ).rejects.toThrow();
    const replica = EgWalkerReplica.fromPortableSnapshot(codec.decode(bytes));
    await replica.prepare();

    // Assert
    expect(replica.getText()).toBe(source().getText());
    expect(replica.getReplayStats().snapshotValidationReplays).toBe(1);
  });

  it("proves bytes this process did not encode before tagging them", async () => {
    // Arrange
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot()).slice();
    const replays = spyOnReplays();

    try {
      // Act
      const tag = await codec.authenticate(bytes, key);

      // Assert
      expect(replays.calls()).toBe(1);
      await expect(
        codec.decodeAuthenticated(bytes, tag, key),
      ).resolves.toMatchObject({ text: source().getText() });
    } finally {
      replays.restore();
    }
  });

  it("does not tag bytes whose text does not match their history", async () => {
    // Arrange: change one character of the text in the header.
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot()).slice();
    const text = new TextEncoder().encode(source().getText());
    const at = bytes.findIndex((_, index) =>
      text.every((byte, offset) => bytes[index + offset] === byte),
    );
    expect(at).toBeGreaterThan(0);
    bytes[at]! ^= 0x01;

    // Act and assert
    await expect(codec.authenticate(bytes, key)).rejects.toThrow(
      /materialized text mismatch/,
    );
  });

  it("reads the bytes and the tag when it is called", async () => {
    // Arrange
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot());
    const original = bytes.slice();

    // Act: change the caller's arrays before either promise settles.
    const tagged = codec.authenticate(bytes, key);
    bytes.fill(0);
    const tag = await tagged;
    const decoded = codec.decodeAuthenticated(original, tag, key);
    original.fill(0);
    tag.fill(0);

    // Assert
    expect((await decoded).text).toBe(source().getText());
  });

  it("needs Web Crypto, bytes and a tag", async () => {
    // Arrange
    const key = await hmacKey();
    const bytes = codec.encode(source().createPortableSnapshot());
    const tag = await codec.authenticate(bytes, key);

    // Act and assert
    await expect(
      codec.decodeAuthenticated(bytes, [...tag] as never, key),
    ).rejects.toThrow(/tag must be a Uint8Array/);
    await expect(codec.authenticate([...bytes] as never, key)).rejects.toThrow(
      /expected EGWP1 bytes/,
    );
    vi.stubGlobal("crypto", {});
    try {
      await expect(codec.authenticate(bytes, key)).rejects.toThrow(
        /needs Web Crypto/,
      );
      await expect(codec.decodeAuthenticated(bytes, tag, key)).rejects.toThrow(
        /needs Web Crypto/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("needs an HMAC SHA-256 key", async () => {
    // Arrange
    const bytes = codec.encode(source().createPortableSnapshot());
    const sha512 = await hmacKey("SHA-512");
    const aes = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    // Act and assert
    await expect(codec.authenticate(bytes, sha512)).rejects.toThrow(
      /HMAC SHA-256/,
    );
    await expect(codec.authenticate(bytes, aes)).rejects.toThrow(
      /HMAC SHA-256/,
    );
    await expect(
      codec.decodeAuthenticated(bytes, new Uint8Array(32), aes),
    ).rejects.toThrow(/HMAC SHA-256/);
  });
});
